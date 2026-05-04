import { Link } from 'react-router-dom';

const sampleShopSlug = 'demo-shop';
const sampleProjectId = 'demo-project';

const link = 'text-indigo-600 underline-offset-2 hover:underline';

export default function Home() {
  return (
    <main className="mx-auto max-w-xl px-5 py-5">
      <h1 className="mb-3 text-2xl font-semibold text-gray-900">群购订单管理</h1>
      <p className="mb-6 text-gray-600">
        路由骨架已就绪。以下为占位链接，后续替换为真实数据与鉴权。
      </p>
      <section className="mb-6">
        <h2 className="mb-2 text-base font-semibold text-gray-900">平台</h2>
        <ul className="list-disc space-y-1 pl-5 text-gray-800">
          <li>
            <Link className={link} to="/login">
              登录
            </Link>
          </li>
          <li>
            <Link className={link} to="/register">
              注册
            </Link>
          </li>
          <li>
            <Link className={link} to="/invite/demo-code">
              管理员邀请（示例）
            </Link>
          </li>
        </ul>
      </section>
      <section className="mb-6">
        <h2 className="mb-2 text-base font-semibold text-gray-900">顾客端</h2>
        <ul className="list-disc space-y-1 pl-5 text-gray-800">
          <li>
            <Link
              className={link}
              to={`/shop/${sampleShopSlug}/${sampleProjectId}`}
            >
              项目首页 /shop/:shopSlug/:projectId
            </Link>
          </li>
          <li>
            <Link
              className={link}
              to={`/shop/${sampleShopSlug}/${sampleProjectId}/order`}
            >
              下单 /shop/.../order
            </Link>
          </li>
          <li>
            <Link
              className={link}
              to={`/shop/${sampleShopSlug}/${sampleProjectId}/my-orders`}
            >
              我的订单 /shop/.../my-orders
            </Link>
          </li>
          <li>
            <Link
              className={link}
              to={`/shop/${sampleShopSlug}/${sampleProjectId}/orders/order-1`}
            >
              订单详情 /shop/.../orders/:orderId
            </Link>
          </li>
        </ul>
      </section>
      <section>
        <h2 className="mb-2 text-base font-semibold text-gray-900">商户后台</h2>
        <ul className="list-disc space-y-1 pl-5 text-gray-800">
          <li>
            <Link className={link} to="/dashboard">
              我的店铺列表
            </Link>
          </li>
          <li>
            <Link className={link} to={`/dashboard/${sampleShopSlug}`}>
              店铺 Dashboard
            </Link>
          </li>
          <li>
            <Link className={link} to={`/dashboard/${sampleShopSlug}/projects`}>
              项目列表
            </Link>
          </li>
          <li>
            <Link
              className={link}
              to={`/dashboard/${sampleShopSlug}/projects/new`}
            >
              新建项目
            </Link>
          </li>
          <li>
            <Link
              className={link}
              to={`/dashboard/${sampleShopSlug}/projects/proj-1`}
            >
              编辑项目
            </Link>
          </li>
          <li>
            <Link className={link} to={`/dashboard/${sampleShopSlug}/orders`}>
              订单管理
            </Link>
          </li>
          <li>
            <Link
              className={link}
              to={`/dashboard/${sampleShopSlug}/delivery-points`}
            >
              配送点
            </Link>
          </li>
          <li>
            <Link className={link} to={`/dashboard/${sampleShopSlug}/admins`}>
              管理员
            </Link>
          </li>
          <li>
            <Link className={link} to={`/dashboard/${sampleShopSlug}/settings`}>
              店铺设置
            </Link>
          </li>
        </ul>
      </section>
    </main>
  );
}
