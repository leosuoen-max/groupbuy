# 会话交接 · 下一任助手请先读这里

> 仓库路径示例：`…/点餐小软件/groupbuy`（注意：**不要**打开名称里带多余空格的那份文件夹）。前端应用目录：**`groupbuy/web/`**，Firebase 环境变量必须在 **`web/.env.local`**（与 `web/package.json` 同级）。

**说明：** Cursor **不会**在每次续写会话时自动读取本文件。新开聊天、换设备、或交接给人时，建议在首条消息写「先读 `HANDOVER.md`」，或在规则里写上这一点。**重大架构或流程变更后**，请顺手更新第二节（或改对应 `docs/`），避免下文过时。

---

## 一、请先按顺序阅读的文件

| 顺序 | 路径 | 说明 |
|:----:|------|------|
| 1 | `README.md` | 产品一句话定位、技术栈、路由结构 |
| 2 | `CURSOR_GUIDE.md` | Cursor 建议的阅读顺序与开发顺序 |
| 3 | `HANDOVER.md` | **本文件**：仓库现状摘要（需随里程碑更新） |
| 4 | `docs/08-第一版范围.md` | MVP 做/不做 |
| 5 | `docs/06-数据模型.md` | Firestore 集合与字段 |
| 6 | `docs/03-顾客端功能.md` | 顾客端需求细节 |
| 7 | `docs/04-商户后台功能.md` | 商户端需求细节 |
| 8 | `docs/07-技术方案.md` | 路由与技术选型 |

开发细节不确定时，继续查 **`docs/10-设计原则.md`**。

---

## 二、当前仓库里「我们已经做了什么」（摘要）

### 基础设施

- **`groupbuy/web`**：Vite + React + TypeScript + **Tailwind CSS v3** + **react-router-dom v7**。
- **Firebase**：`web/src/lib/firebase.ts`（`getDb` / `getAuthClient` / `getStorageClient`），环境变量 **`VITE_FIREBASE_*`**。
- **Git**：在 `groupbuy` 根目录维护提交。
- **规则**：根目录 **`firestore.rules`**；Storage 规则在 Firebase 控制台配置。**开发期可用宽松规则，上线前必须按店铺/身份收紧并部署。**

### 顾客端（默认走 Firestore）

- **路由**：`/shop/:shopSlug/:projectId` 及子路由（下单、我的订单、订单详情等）见 `web/src/appRoutes.tsx`。
- **`ShopHome`**：`web/src/pages/customer/ShopHome.tsx`  
  - **默认**：`web/src/lib/shopHomeService.ts` 的 **`loadShopHomeFromFirestore`**，按 `shopSlug` + `projectId` 读 **`shops` / `projects`**，映射为与页面兼容的展示结构（类型仍复用 `mockShopHome.ts` 里的 `MockShopHome` 形状）。  
  - **演示**：URL 加 **`?mock=1`** 时使用 **`getMockShopHome`**，不访问 Firestore。
- **下单**：`OrderForm` → **`createOrder`**（`web/src/lib/orderService.ts`），订单写入 **`orders`** 集合；库存与事务逻辑以代码为准，对照 **`docs/06` / `docs/07`**。
- **我的订单 / 订单详情**：`listOrdersByCustomer`、`getOrderByNumber` 等读 Firestore；顾客身份为 **`customerIdentity`** 的 localStorage **customerKey**。
- **付款截图**：上传到 Storage（`paymentImageUpload.ts`），订单字段 **`paymentScreenshots`**（含 MD5、三色 `flag` 等）；**上传后未付款单可进入待核实**；支持 **删除误传图片** 并尽量删除 Storage 对象。详见 `orderService` 中 `customerUploadPaymentScreenshot` / `customerDeletePaymentScreenshot`。
- **`MyOrders` 列表**：展示订单状态与是否已传截图（与详情逻辑一致）。

### 商户端（Firestore + 匿名登录开发）

- **登录**：开发阶段常用 Firebase **匿名登录**（`Login.tsx` 等）；正式方案见 **`docs/05`**。
- **店铺 / 项目**：`shopService`、`projectService`；项目编辑、发布等与 **`docs/06`** 对齐。
- **订单 / 对账 / 核销**：订单管理、对账单、凭证面板等已接入 Firestore；**`PaymentScreenshotsPanel`** 已展示三色与原因，顶栏一句「后续可接入…」文案仅为遗留提示，可删改文案与代码对齐。
- **`Dashboard`**（`MerchantDashboard`）：已有入口跳转项目/订单/对账等；**「今日数据、订单概览」仍可为占位**，若要贴合 **docs/04 4.1**，需再接 Firestore 统计。

### 需用户在本机 / Firebase 控制台完成的事项

- **Authentication**：按需启用匿名登录（商户调试）；生产按 **`docs/05`** 收紧。
- **Firestore / Storage**：部署或测试规则；**切勿长期对生产环境使用「全库可读可写」类临时规则**。
- **`web/.env.local`**：六个 `VITE_FIREBASE_*`；勿提交 Git（见 `.gitignore`）；修改后重启 `npm run dev`。

---

## 三、建议的「下一步」（优先级）

按 **上线与真实使用** 优先，其次才是新功能。

1. **安全与上线**：收紧 **Firestore / Storage** 规则；按 **`docs/08`**「上线判断标准」在微信/WhatsApp、商户 PWA 场景跑通全流程。
2. **商户 Dashboard**：若要对齐需求文档，把「今日数据、订单概览」从占位改为 Firestore 聚合（可按店铺当日项目筛选订单）。
3. **文案与权限**：商户 **`Dashboard`** 上「仅创建人」等提示若已接入多级管理员（`permissionService`），可核对是否仍写「mock」字样并改正。
4. **文档同步**：功能大改后更新 **`HANDOVER` 第二节** 或 **`docs/08`**，避免交接误导。

更细的「第二版」功能见 **`docs/08`** 文末「后续迭代方向」。

---

## 四、建议你额外告诉下一任助手的事（易踩坑）

1. **路径**：`npm run dev` 须在 **`groupbuy/web`**。
2. **环境变量**：只认 **`web/.env.local`**；改后重启开发服务器。
3. **白屏**：若 Firebase 初始化报错，先查 Console 与 env 是否在 **`web/`** 目录。
4. **ESLint**：部分页面用 **`queueMicrotask`** 包一层数据加载以规避 `react-hooks/set-state-in-effect`，改动加载逻辑时注意规则。
5. **安全**：规则与 App Check、Storage 路径限制见 **`docs/06`** 与团队约定。
6. **产品红线**：见 **`docs/10`** 与 **`README`**（顾客端无第三方广告、付款核实为辅助等）。

---

## 五、可选：交接用语（复制到新会话首条）

```
请读 groupbuy 根目录的 HANDOVER.md、README.md、CURSOR_GUIDE.md，再按 HANDOVER「一、请先按顺序阅读」补读 docs。
当前前端在 web/；顾客端默认 ShopHome 读 Firestore，订单与付款截图已写 Firestore + Storage。
请从 HANDOVER「三、建议的下一步」与我本条任务描述继续。
```

（把路径换成本机实际路径；任务描述写清要做的具体事。）

---

*若与代码不一致，以仓库内代码与 `docs/` 为准；本文件应在里程碑或架构变更后人工更新。*
