import { PageShell } from '../../components/PageShell';

/** 登录后「我的店铺列表」：/dashboard */
export default function ShopList() {
  return (
    <PageShell
      title="商户 · 我的店铺"
      subtitle="/dashboard"
    >
      <p style={{ margin: 0, opacity: 0.88 }}>
        占位：多店铺切换、进入各店后台（见 README / docs/04）。
      </p>
    </PageShell>
  );
}
