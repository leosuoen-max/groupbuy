/// <reference types="vite/client" />

declare module 'virtual:deploy-build-id' {
  /** 生产构建为随机 UUID，开发为 "dev" */
  export const DEPLOY_BUILD_ID: string;
}

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  /** 顾客端「定制店铺」联系文案，见 `src/config/siteContact.ts` */
  readonly VITE_CUSTOM_SHOP_CONTACT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
