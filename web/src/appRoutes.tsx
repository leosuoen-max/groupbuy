import { Route, Routes } from 'react-router-dom';
import MerchantEntry from './pages/MerchantEntry';
import HomeLinks from './pages/HomeLinks';
import Login from './pages/Login';
import Register from './pages/Register';
import InviteAccept from './pages/InviteAccept';
import NotFound from './pages/NotFound';
import ShopHome from './pages/customer/ShopHome';
import OrderForm from './pages/customer/OrderForm';
import MyOrders from './pages/customer/MyOrders';
import OrderAppend from './pages/customer/OrderAppend';
import OrderDetail from './pages/customer/OrderDetail';
import ShopList from './pages/merchant/ShopList';
import MerchantDashboard from './pages/merchant/Dashboard';
import ProjectList from './pages/merchant/ProjectList';
import ProjectEdit from './pages/merchant/ProjectEdit';
import OrderManagement from './pages/merchant/OrderManagement';
import MerchantOrderDetail from './pages/merchant/MerchantOrderDetail';
import ReconciliationStatement from './pages/merchant/ReconciliationStatement';
import DeliveryPoints from './pages/merchant/DeliveryPoints';
import AdminManagement from './pages/merchant/AdminManagement';
import ShopSettings from './pages/merchant/ShopSettings';
import CardTemplates from './pages/merchant/CardTemplates';
import CardTemplateDetail from './pages/merchant/CardTemplateDetail';
import ProductLibrary from './pages/merchant/ProductLibrary';
import CustomerCards from './pages/customer/CustomerCards';
import CustomerCardBuy from './pages/customer/CustomerCardBuy';
import PlatformRegistrations from './pages/PlatformRegistrations';
import PlatformShops from './pages/PlatformShops';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<MerchantEntry />} />
      <Route path="/home" element={<HomeLinks />} />
      <Route path="/login" element={<Login />} />
      <Route path="/invite-register/:token" element={<Register />} />
      <Route path="/register" element={<Register />} />
      <Route path="/invite/:code" element={<InviteAccept />} />

      <Route path="/admin/registrations" element={<PlatformRegistrations />} />
      <Route path="/admin/shops" element={<PlatformShops />} />

      <Route path="/dashboard" element={<ShopList />} />
      <Route path="/dashboard/:shopSlug" element={<MerchantDashboard />} />
      <Route
        path="/dashboard/:shopSlug/projects"
        element={<ProjectList />}
      />
      <Route
        path="/dashboard/:shopSlug/projects/new"
        element={<ProjectEdit />}
      />
      <Route
        path="/dashboard/:shopSlug/projects/:projectId"
        element={<ProjectEdit />}
      />
      <Route
        path="/dashboard/:shopSlug/order/:projectId/:orderNumber"
        element={<MerchantOrderDetail />}
      />
      <Route
        path="/dashboard/:shopSlug/orders"
        element={<OrderManagement />}
      />
      <Route
        path="/dashboard/:shopSlug/reconciliation"
        element={<ReconciliationStatement />}
      />
      <Route
        path="/dashboard/:shopSlug/delivery-points"
        element={<DeliveryPoints />}
      />
      <Route
        path="/dashboard/:shopSlug/admins"
        element={<AdminManagement />}
      />
      <Route
        path="/dashboard/:shopSlug/settings"
        element={<ShopSettings />}
      />
      <Route
        path="/dashboard/:shopSlug/cards"
        element={<CardTemplates />}
      />
      <Route
        path="/dashboard/:shopSlug/cards/:templateId"
        element={<CardTemplateDetail />}
      />
      <Route
        path="/dashboard/:shopSlug/product-library"
        element={<ProductLibrary />}
      />

      <Route
        path="/shop/:shopSlug/:projectId/order"
        element={<OrderForm />}
      />
      <Route
        path="/shop/:shopSlug/:projectId/my-orders"
        element={<MyOrders />}
      />
      <Route
        path="/shop/:shopSlug/:projectId/orders/:orderId/add-items"
        element={<OrderAppend />}
      />
      <Route
        path="/shop/:shopSlug/:projectId/orders/:orderId"
        element={<OrderDetail />}
      />
      <Route path="/shop/:shopSlug/cards" element={<CustomerCards />} />
      <Route
        path="/shop/:shopSlug/cards/buy/:templateId"
        element={<CustomerCardBuy mode="purchase" />}
      />
      <Route
        path="/shop/:shopSlug/cards/topup/:cardId"
        element={<CustomerCardBuy mode="topup" />}
      />

      <Route path="/shop/:shopSlug/:projectId" element={<ShopHome />} />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
