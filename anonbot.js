require('dotenv').config({ path: `${__dirname}/.env` });
const {
  Client,
  GatewayIntentBits,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  WebhookClient,
  SlashCommandBuilder,
  PermissionsBitField,
} = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const http = require('http');

const requiredEnv = ['BOT_TOKEN', 'CHANNEL_ID', 'WEBHOOK_URL', 'GUILD_ID'];
for (const env of requiredEnv) {
  if (!process.env[env]) {
    console.error(`[FATAL] エラー: .envファイルに${env}が定義されていません。`);
    process.exit(1);
  }
}
console.log('[DEBUG] 環境変数:', {
  BOT_TOKEN: process.env.BOT_TOKEN ? '読み込み成功' : 'undefined',
  CHANNEL_ID: process.env.CHANNEL_ID ? '読み込み成功' : 'undefined',
  WEBHOOK_URL: process.env.WEBHOOK_URL ? '読み込み成功' : 'undefined',
  GUILD_ID: process.env.GUILD_ID ? '読み込み成功' : 'undefined',
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
  ],
});

const dataFile = path.join(__dirname, 'data', 'messageData.json');
let messageData = { lastMessageId: 0, messages: {} };

async function loadData() {
  try {
    const data = await fs.readFile(dataFile, 'utf8');
    messageData = JSON.parse(data);
    console.log('[INFO] データファイル読み込み成功');
  } catch (error) {
    console.log('[WARN] データファイルが見つからないため、新規作成します。');
    await saveData();
  }
}

async function saveData() {
  try {
    await fs.mkdir(path.dirname(dataFile), { recursive: true });
    await fs.writeFile(dataFile, JSON.stringify(messageData, null, 2));
    console.log('[INFO] データ保存成功');
  } catch (error) {
    console.error('[ERROR] データ保存失敗:', error.message);
    throw error;
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    const healthStatus = {
      status: client.isReady() ? 'healthy' : 'unhealthy',
      discordConnected: client.isReady(),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      dataFileAccessible: false,
    };
    fs.access(dataFile)
      .then(() => {
        healthStatus.dataFileAccessible = true;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(healthStatus));
      })
      .catch((error) => {
        healthStatus.dataFileAccessible = false;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...healthStatus, error: error.message }));
      });
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running');
  }
});
server.listen(process.env.PORT || 8080, () => {
  console.log(`[INFO] HTTP server running on port ${process.env.PORT || 8080}`);
});

async function clearOldButtons(channel) {
  try {
    const messages = await channel.messages.fetch({ limit: 100 });
    const botMessages = messages.filter(
      (msg) =>
        msg.author.id === client.user.id &&
        msg.components.length > 0 &&
        msg.components[0].components.some((comp) => comp.customId === 'anonymous_message_button')
    );
    for (const msg of botMessages.values()) {
      await msg.delete();
      console.log(`[INFO] 古いボタンメッセージを削除: ${msg.id}`);
    }
    console.log('[INFO] 古いボタンの削除処理が完了しました');
  } catch (error) {
    console.error('[ERROR] 古いボタンメッセージの削除失敗:', error.message);
  }
}

async function registerSlashCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('reveal')
      .setDescription('指定したレス番号の匿名メッセージの送信者を開示します（管理者のみ）')
      .addIntegerOption((option) =>
        option.setName('message_id').setDescription('開示するメッセージのレス番号').setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),
  ];

  try {
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (guild) {
      await guild.commands.set(commands);
      console.log('[INFO] スラッシュコマンドをサーバーに登録しました');
    } else {
      console.log('[WARN] ギルドが見つからないため、グローバルにコマンドを登録します');
      await client.application.commands.set(commands);
      console.log('[INFO] スラッシュコマンドをグローバルに登録しました');
    }
  } catch (error) {
    console.error('[ERROR] スラッシュコマンド登録失敗:', error.message);
  }
}

async function setupButton(channel) {
  const button = new ButtonBuilder()
    .setCustomId('anonymous_message_button')
    .setLabel('匿名メッセージを送信')
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(button);

  try {
    await channel.send({ components: [row] });
    console.log('[INFO] ボタンをチャンネルに設置しました');
  } catch (error) {
    console.error('[ERROR] ボタン設置失敗:', error.message);
  }
}

client.once('ready', async () => {
  console.log(`[INFO] ログインしました: ${client.user.tag}`);
  await loadData();
  await registerSlashCommands();
  const channel = client.channels.cache.get(process.env.CHANNEL_ID);
  if (channel) {
    console.log('[INFO] ボット再起動に伴いボタンを再配置します');
    await clearOldButtons(channel);
    await setupButton(channel);
    console.log('[INFO] 再起動後のボタン再配置が完了しました');
  } else {
    console.error('[FATAL] チャンネルが見つかりません: CHANNEL_ID=' + process.env.CHANNEL_ID);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton() && interaction.customId === 'anonymous_message_button') {
    const modal = new ModalBuilder().setCustomId('anonymous_message_modal').setTitle('匿名メッセージ');

    const messageInput = new TextInputBuilder()
      .setCustomId('message_input')
      .setLabel('メッセージ (200文字以内、改行1回まで)')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(200)
      .setRequired(true);

    const row = new ActionRowBuilder().addComponents(messageInput);
    modal.addComponents(row);

    try {
      await interaction.showModal(modal);
      console.log('[INFO] モーダルを表示しました');
    } catch (error) {
      console.error('[ERROR] モーダル表示失敗:', error.message);
      await interaction.reply({ content: 'モーダルの表示に失敗しました。', ephemeral: true });
    }
  }

  if (interaction.isModalSubmit() && interaction.customId === 'anonymous_message_modal') {
    const message = interaction.fields.getTextInputValue('message_input');
    const lineBreaks = (message.match(/\n/g) || []).length;
    if (lineBreaks > 1) {
      await interaction.reply({ content: '改行は1回までです。', ephemeral: true });
      return;
    }

    const sanitizedMessage = message.replace(/@everyone/g, '@-everyone').replace(/@here/g, '@-here');
    let webhookSuccess = false;
    try {
      const webhook = new WebhookClient({ url: process.env.WEBHOOK_URL });
      messageData.lastMessageId += 1;
      const messageId = messageData.lastMessageId;
      await webhook.send({ content: sanitizedMessage, username: `${messageId} 飯能の名無しさん ` });
      webhookSuccess = true;
      messageData.messages[messageId] = {
        content: sanitizedMessage,
        timestamp: new Date().toISOString(),
        authorId: interaction.user.id,
      };
      await saveData();
      const channel = client.channels.cache.get(process.env.CHANNEL_ID);
      if (channel) {
        await clearOldButtons(channel);
        await setupButton(channel);
      }
      await interaction.reply({ content: '匿名メッセージを送信しました！', ephemeral: true });
    } catch (error) {
      console.error('[ERROR] モーダル送信処理失敗:', error);
      if (webhookSuccess) {
        await interaction.reply({ content: '送信済みですが、内部エラーが発生しました。', ephemeral: true });
      } else {
        await interaction.reply({ content: 'メッセージ送信に失敗しました。', ephemeral: true });
      }
    }
  }

  if (interaction.isCommand() && interaction.commandName === 'reveal') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      await interaction.reply({ content: 'このコマンドは管理者専用です。', ephemeral: true });
      return;
    }

    const messageId = interaction.options.getInteger('message_id');
    const messageDataEntry = messageData.messages[messageId];

    if (!messageDataEntry) {
      await interaction.reply({ content: `レス番号 ${messageId} は存在しません。`, ephemeral: true });
      return;
    }

    try {
      const author = await client.users.fetch(messageDataEntry.authorId);
      const content = [
        `📩 レス番号: ${messageId}`,
        `👤 送信者: ${author.tag} (ID: ${author.id})`,
        `📜 内容: ${messageDataEntry.content}`,
        `🕒 送信日時: ${messageDataEntry.timestamp}`,
      ].join('\n');

      await interaction.reply({ content, ephemeral: true });
    } catch (error) {
      console.error('[ERROR] ユーザー取得失敗:', error);
      await interaction.reply({ content: '送信者情報の取得に失敗しました。', ephemeral: true });
    }
  }
});

client.on('error', (error) => {
  console.error('[ERROR] クライアントエラー:', error.message);
  if (error.message.includes('disallowed intents')) {
    console.error('[FATAL] 特権インテントが許可されていません。');
    process.exit(1);
  }
});

process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error);
  process.exit(1);
});

process.on('warning', (warning) => {
  console.warn('[WARNING]', warning);
});

process.on('SIGTERM', () => {
  console.log('[INFO] SIGTERM received. Closing client and server...');
  client.destroy();
  server.close();
  process.exit(0);
});

setInterval(() => {
  console.log(`[INFO] プロセス稼働中: ${new Date().toISOString()}`);
}, 60000);

client.login(process.env.BOT_TOKEN).catch((error) => {
  console.error('[FATAL] ログイン失敗:', error.message);
  process.exit(1);
});
