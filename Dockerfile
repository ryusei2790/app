# =============================================================================
# Dockerfile — Next.js 開発用コンテナ
# 役割: ローカル開発環境を Docker で統一する。ホットリロード対応。
# =============================================================================

FROM node:20-alpine

WORKDIR /app

# 依存関係インストール（package.json が変わった時のみ再実行）
COPY package*.json ./
RUN npm install

# ソースコードはボリュームマウントで同期するため COPY 不要（開発用）
# 本番ビルド時は COPY . . → RUN npm run build を追加する

EXPOSE 3000

CMD ["npm", "run", "dev"]
