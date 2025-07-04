require('dotenv').config({ path: `${__dirname}/.env` });
const { Client, GatewayIntentBits, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, WebhookClient, SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const http = require('http');

// 環境変数の確認
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

// HTTPサーバー（ヘルスチェック用）
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

// クライアントの初期化
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
  ],
});

// データ保存用のファイルパス
const dataFile = path.join(__dirname, 'messageData.json');

// メッセージ番号を管理するオブジェクト
let messageData = { lastMessageId: 0, messages: {} };

// データの読み込み
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

// データの保存
async function saveData() {
  try {
    await fs.writeFile(dataFile, JSON.stringify(messageData, null, 2));
    console.log('[INFO] データ保存成功');
  } catch (error) {
    console.error('[ERROR] データ保存失敗:', error.message);
    throw error; // エラーを上位に伝播
  }
}

// 古いボタンメッセージを削除
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
  } catch (error) {
    console.error('[ERROR] 古いボタンメッセージの削除失敗:', error.message);
  }
}

// スラッシュコマンドの登録
async function registerSlashCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('reveal')
      .setDescription('指定したレス番号の匿名メッセージの送信者を開示します（管理者のみ）')
      .addIntegerOption((option) =>
        option
          .setName('message_id')
          .setDescription('開示するメッセージのレス番号')
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),
  ];

  try {
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (guild) {
      await guild.commands.set(commands);
      console.log('[INFO] スラッシュコマンドをサーバーに登録しました');
    } else {
      await client.application.commands.set(commands);
      console.log('[INFO] スラッシュコマンドをグローバルに登録しました');
    }
  } catch (error) {
    console.error('[ERROR] スラッシュコマンド登録失敗:', error.message);
  }
}

// ボットの準備完了時
client.once('ready', async () => {
  console.log(`[INFO] ログインしました: ${client.user.tag} (ID: ${client.user.id}) - ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} JST`);
  await loadData();
  await registerSlashCommands();
  const channel = client.channels.cache.get(process.env.CHANNEL_ID);
  if (channel) {
    await clearOldButtons(channel);
    await setupButton(channel);
  } else {
    console.error('[ERROR] チャンネルが見つかりません。');
  }
});

// ボタンのセットアップ
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

// インタラクション処理
client.on('interactionCreate', async (interaction) => {
  // ボタン処理
  if (interaction.isButton() && interaction.customId === 'anonymous_message_button') {
    const modal = new ModalBuilder()
      .setCustomId('anonymous_message_modal')
      .setTitle('匿名メッセージ');

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

  // モーダル送信処理
  if (interaction.isModalSubmit() && interaction.customId === 'anonymous_message_modal') {
    const message = interaction.fields.getTextInputValue('message_input');
    console.log(`[DEBUG] モーダル入力受信: ${message}`);

    // 改行チェック
    const lineBreaks = (message.match(/\n/g) || []).length;
    if (lineBreaks > 1) {
      await interaction.reply({ content: '改行は1回までです。', ephemeral: true });
      console.log('[INFO] 改行制限エラー');
      return;
    }

    // @everyone や @here を無効化
    const sanitizedMessage = `[#${messageData.lastMessageId + 1}] ${message
      .replace(/@everyone/g, '@-everyone')
      .replace(/@here/g, '@-here')}`;
    console.log(`[DEBUG] サニタイズされたメッセージ: ${sanitizedMessage}`);

    // Webhook でメッセージ送信
    let webhookSuccess = false;
    try {
      const webhook = new WebhookClient({ url: process.env.WEBHOOK_URL });
      messageData.lastMessageId += 1;
      const messageId = messageData.lastMessageId;

      await webhook.send({ content: sanitizedMessage });
      console.log(`[INFO] 匿名メッセージ送信成功: レス番号 ${messageId}`);
      webhookSuccess = true;

      // メッセージデータに送信者情報を保存
      messageData.messages[messageId] = {
        content: sanitizedMessage,
        timestamp: new Date().toISOString(),
        authorId: interaction.user.id,
      };
      await saveData();
      console.log(`[INFO] メッセージデータ保存成功: レス番号 ${messageId}`);

      await interaction.reply({ content: '匿名メッセージを送信しました！', ephemeral: true });
    } catch (error) {
      console.error('[ERROR] モーダル送信処理失敗:', {
        message: error.message,
        stack: error.stack,
        webhookSuccess,
      });
      if (webhookSuccess) {
        // Webhook送信は成功したが、データ保存または返信でエラー
        await interaction.reply({ content: 'メッセージは送信されましたが、処理中にエラーが発生しました。管理者にお問い合わせください。', ephemeral: true });
      } else {
        await interaction.reply({ content: 'メッセージ送信に失敗しました。', ephemeral: true });
      }
    }
  }

  // スラッシュコマンド処理
  if (interaction.isCommand() && interaction.commandName === 'reveal') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      await interaction.reply({ content: 'このコマンドはサーバー管理者専用です。', ephemeral: true });
      console.log('[INFO] 権限不足で/revealコマンド拒否');
      return;
    }

    const messageId = interaction.options.getInteger('message_id');
    const messageDataEntry = messageData.messages[messageId];

    if (!messageDataEntry) {
      await interaction.reply({ content: `レス番号 ${messageId} のメッセージが見つかりません。`, ephemeral: true });
      console.log(`[INFO] レス番号 ${messageId} が見つかりません`);
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
      console.log(`[INFO] レス番号 ${messageId} の送信者情報を開示: ${author.tag}`);
    } catch (error) {
      console.error('[ERROR] 送信者情報取得失敗:', error.message);
      await interaction.reply({ content: '送信者情報の取得に失敗しました。', ephemeral: true });
    }
  }
});

// エラーハンドリング（インテントエラー対応強化）
client.on('error', (error) => {
  console.error('[ERROR] クライアントエラー:', error.message);
  if (error.message.includes('disallowed intents')) {
    console.error('[FATAL] 特権インテントが許可されていません。Discord Developer Portalで「Server Members Intent」を有効化してください。');
    process.exit(1);
  }
});

process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error);
  if (error.message.includes('disallowed intents')) {
    console.error('[FATAL] 特権インテントが許可されていません。Discord Developer Portalで「Server Members Intent」を有効化してください。');
  }
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

// プロセスを維持するためのハートビートログ
setInterval(() => {
  console.log(`[INFO] プロセス稼働中: ${new Date().toISOString()}`);
}, 60000);

// ボットログイン
client.login(process.env.BOT_TOKEN).catch((error) => {
  console.error('[FATAL] ログイン失敗:', error.message);
  if (error.message.includes('disallowed intents')) {
    console.error('[FATAL] 特権インテントが許可されていません。Discord Developer Portalで「Server Members Intent」を有効化してください。');
  }
  process.exit(1);
});