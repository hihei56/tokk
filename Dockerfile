# Node.js公式イメージをベースに使用（バージョンは必要に応じて調整）
FROM node:18

# 作業ディレクトリを作成
WORKDIR /app

# package.jsonとpackage-lock.jsonをコピー
COPY package*.json ./

# 依存関係をインストール
RUN npm install --production

# ソースコードをすべてコピー
COPY . .

# ポート8080を公開（HTTPヘルスチェック用）
EXPOSE 8080

# 環境変数はGCE側で設定する想定なのでDockerfileには書かない

# アプリ起動コマンド
CMD ["node", "index.js"]
