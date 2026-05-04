import { Route, Routes } from 'react-router-dom';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import InviteAccept from './pages/InviteAccept';
import NotFound from './pages/NotFound';
import ShopHome from './pages/customer/ShopHome';
import OrderForm from './pages/customer/OrderForm';
import MyOrders from './pages/customer/MyOrders';
import OrderDetail from './pages/customer/OrderDetail';
import ShopList from './pages/merchant/ShopList';
import MerchantDashboard from './pages/merchant/Dashboard';
import ProjectList from './pages/merchant/ProjectList';
import ProjectEdit from './pages/merchant/ProjectEdit';
import OrderManagement from './pages/merchant/OrderManagement';
import DeliveryPoints from './pages/merchant/DeliveryPoints';
import AdminManagement from './pages/merchant/AdminManagement';
import ShopSettings from './pages/merchant/ShopSettings';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/invite/:code" element={<InviteAccept />} />

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
        path="/dashboard/:shopSlug/orders"
        element={<OrderManagement />}
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
        path="/shop/:shopSlug/:projectId/order"
        element={<OrderForm />}
      />
      <Route
        path="/shop/:shopSlug/:projectId/my-orders"
        element={<MyOrders />}
      />
      <Route
        path="/shop/:shopSlug/:projectId/orders/:orderId"
        element={<OrderDetail />}
      />
      <Route path="/shop/:shopSlug/:projectId" element={<ShopHome />} />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
