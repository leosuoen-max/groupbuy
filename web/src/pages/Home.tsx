import { Link } from 'react-router-dom';

const sampleShopSlug = 'demo-shop';
const sampleProjectId = 'demo-project';

export default function Home() {
  return (
    <main style={{ padding: '1.25rem', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', color: 'var(--text-h)', marginTop: 0 }}>
        群购订单管理
      </h1>
      <p style={{ marginBottom: '1.25rem' }}>
        路由骨架已就绪。以下为占位链接，后续替换为真实数据与鉴权。
      </p>
      <section style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '1.05rem', color: 'var(--text-h)' }}>平台</h2>
        <ul>
          <li>
            <Link to="/login">登录</Link>
          </li>
          <li>
            <Link to="/register">注册</Link>
          </li>
          <li>
            <Link to="/invite/demo-code">管理员邀请（示例）</Link>
          </li>
        </ul>
      </section>
      <section style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '1.05rem', color: 'var(--text-h)' }}>顾客端</h2>
        <ul>
          <li>
            <Link to={`/shop/${sampleShopSlug}/${sampleProjectId}`}>
              项目首页 /shop/:shopSlug/:projectId
            </Link>
          </li>
          <li>
            <Link
              to={`/shop/${sampleShopSlug}/${sampleProjectId}/order`}
            >
              下单 /shop/.../order
            </Link>
          </li>
          <li>
            <Link
              to={`/shop/${sampleShopSlug}/${sampleProjectId}/my-orders`}
            >
              我的订单 /shop/.../my-orders
            </Link>
          </li>
          <li>
            <Link
              to={`/shop/${sampleShopSlug}/${sampleProjectId}/orders/order-1`}
            >
              订单详情 /shop/.../orders/:orderId
            </Link>
          </li>
        </ul>
      </section>
      <section>
        <h2 style={{ fontSize: '1.05rem', color: 'var(--text-h)' }}>商户后台</h2>
        <ul>
          <li>
            <Link to="/dashboard">我的店铺列表</Link>
          </li>
          <li>
            <Link to={`/dashboard/${sampleShopSlug}`}>店铺 Dashboard</Link>
          </li>
          <li>
            <Link to={`/dashboard/${sampleShopSlug}/projects`}>项目列表</Link>
          </li>
          <li>
            <Link to={`/dashboard/${sampleShopSlug}/projects/new`}>
              新建项目
            </Link>
          </li>
          <li>
            <Link to={`/dashboard/${sampleShopSlug}/projects/proj-1`}>
              编辑项目
            </Link>
          </li>
          <li>
            <Link to={`/dashboard/${sampleShopSlug}/orders`}>订单管理</Link>
          </li>
          <li>
            <Link to={`/dashboard/${sampleShopSlug}/delivery-points`}>
              配送点
            </Link>
          </li>
          <li>
            <Link to={`/dashboard/${sampleShopSlug}/admins`}>管理员</Link>
          </li>
          <li>
            <Link to={`/dashboard/${sampleShopSlug}/settings`}>店铺设置</Link>
          </li>
        </ul>
      </section>
    </main>
  );
}
