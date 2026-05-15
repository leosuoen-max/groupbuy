# 给 Cursor 的开发指引

## 第一次打开项目时

请按以下顺序阅读文档：

1. `README.md` — 项目总览
2. `docs/01-产品概述.md` — 理解产品
3. `docs/08-第一版范围.md` — 知道做什么、不做什么（产品目标）
4. `docs/11-需求与实现对照.md` — **路由、数据源、与 docs/08 的落地点差距（代码事实）**
5. `docs/15-实现现状快照.md` — **当前实现形态总览**（饭团/微信/平台后台等；与初版文档分叉处以此定锚）
6. `docs/03-顾客端功能.md` — 顾客端详细功能
7. `docs/04-商户后台功能.md` — 商户端详细功能
8. `docs/05-注册登录.md` — 认证流程
9. `docs/06-数据模型.md` — 数据结构
10. `docs/07-技术方案.md` — 开发方案
11. `docs/09-关键交互流程.md` — 关键场景
12. `docs/02-用户角色与权限.md` — 权限模型
13. `docs/10-设计原则.md` — 设计哲学

读完后，**用一段话总结你的理解**，给用户确认。

---

## 推荐的开发顺序

### 第一步：理解需求

阅读所有文档后，回答这些问题：
- 这个产品是给谁用的？
- 顾客端和商户端的主要差异是什么？
- 有哪些功能是被特别强调"不做"的？
- 第一版的核心场景是什么？

### 第二步：搭建项目骨架

```bash
# 1. 用 Vite 初始化 React + TypeScript 项目
npm create vite@latest . -- --template react-ts

# 2. 安装核心依赖
npm install react-router-dom firebase
npm install -D tailwindcss postcss autoprefixer
npm install -D vite-plugin-pwa

# 3. 配置 Tailwind
npx tailwindcss init -p

# 4. 配置 Firebase
# 让用户提供 Firebase 配置

# 5. 配置路由
# 参考 docs/07-技术方案.md 的路由设计
```

### 第三步：搭建路由和空白页

先把所有页面创建空白文件，确认路由可以跳转：

```
src/pages/
├── Home.tsx                          // 平台首页
├── Login.tsx
├── Register.tsx
├── customer/
│   ├── ShopHome.tsx
│   ├── OrderForm.tsx
│   ├── MyOrders.tsx
│   └── OrderDetail.tsx
└── merchant/
    ├── Dashboard.tsx
    ├── ProjectList.tsx
    ├── ProjectEdit.tsx
    ├── OrderManagement.tsx
    ├── DeliveryPoints.tsx
    ├── AdminManagement.tsx
    └── ShopSettings.tsx
```

### 第四步：从顾客端开始

按这个顺序做：

1. **顾客店铺首页**（`ShopHome.tsx`）
   - 抬头区
   - 内容区两个区块
   - 商品清单
   - 底部固定栏
   - 用 mock 数据先跑通

2. **下单流程**（`OrderForm.tsx`）
   - 选菜
   - 填信息
   - 选配送点
   - 提交

3. **我的订单**（`MyOrders.tsx`, `OrderDetail.tsx`）
   - 订单列表
   - 订单详情
   - 上传付款截图
   - 修改订单 / 加菜

4. **配 Firebase**
   - 把顾客端 mock 数据接入真实 Firestore
   - 测试创建订单的事务（防超卖）

### 第五步：商户端

1. **注册登录**（`Register.tsx`, `Login.tsx`）
   - 手机号验证码
   - Magic Link

2. **商户后台 Dashboard**（`Dashboard.tsx`）

3. **项目管理**（`ProjectList.tsx`, `ProjectEdit.tsx`）

4. **订单管理**（`OrderManagement.tsx`）

5. **其他**：配送点、管理员、店铺设置

### 第六步：完善功能

- 三色提示 + MD5 比对
- 分享卡片生成
- PWA 配置
- 推送通知

### 第七步：测试

- 真机测试（不止模拟器）
- 让用户太太试用
- 修 bug

---

## 协作规则

### 1. 不要自己脑补需求

如果文档模糊，**问用户**：
- "文档里说 XX，但没说 YY 应该怎么处理，你倾向于 A 还是 B？"

不要自作主张。

### 2. 每个功能完成后

主动告诉用户：
- 这个功能完成了
- 实现了哪些点
- 有哪些边界情况已处理
- 有哪些边界情况没处理（如果有）

### 3. 命名遵循文档

参考 `docs/10-设计原则.md` 的命名约定，保持一致。

### 4. 不做被禁止的事

参考 `docs/10-设计原则.md` 的"不要做的事（红线）"，**绝对不做**。

### 5. 主动测试

每个功能完成后：
- 手动测试主流程
- 测试至少一个边界情况
- 确认没有控制台错误

---

## Firebase 配置

让用户做以下事情：

### 1. 创建 Firebase 项目

```
https://console.firebase.google.com/
→ 添加项目
→ 项目名称：groupbuy-app（或其他）
→ 启用 Google Analytics（可选）
```

### 2. 启用服务

- **Firestore Database**：选择"以测试模式启动"
- **Storage**：选择"以测试模式启动"
- **Authentication**：启用"电话"登录方式

### 3. 复制配置

项目设置 → 我的应用 → Web 应用 → 复制配置

填到 `.env.local`：

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

### 4. 部署 Security Rules

参考 `docs/06-数据模型.md` 的安全规则示例。

---

## 部署到 Vercel

```bash
# 1. 安装 Vercel CLI
npm install -g vercel

# 2. 部署
vercel

# 3. 配置环境变量
vercel env add VITE_FIREBASE_API_KEY
# ... 其他环境变量

# 4. 部署到生产
vercel --prod
```

---

## 常见任务速查

### 添加新页面

1. 在 `src/pages/` 下创建文件
2. 在 `src/App.tsx` 添加路由
3. 测试路由跳转
4. 实现页面内容

### 添加新组件

1. 在 `src/components/` 下创建文件（按 customer/merchant/common 分类）
2. 定义 props 接口
3. 实现组件
4. 在使用的地方导入

### 调用 Firestore

```typescript
import { db } from '@/lib/firebase';
import { collection, addDoc, query, where, getDocs } from 'firebase/firestore';

// 添加文档
await addDoc(collection(db, 'orders'), orderData);

// 查询文档
const q = query(
  collection(db, 'orders'),
  where('projectId', '==', projectId)
);
const snapshot = await getDocs(q);
```

### 上传图片

```typescript
import { storage } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const fileRef = ref(storage, `screenshots/${orderId}/${Date.now()}.jpg`);
await uploadBytes(fileRef, file);
const url = await getDownloadURL(fileRef);
```

---

## 当前状态（以仓库代码为准）

- 需求文档与代码并行演进；实现细节优先看 `docs/11-需求与实现对照.md`
- 前端主应用位于 `web/`，已包含顾客端与商户端核心页面及业务服务层
- Firebase 仍需用户在本机配置 `web/.env.local` 并按需部署安全规则
- 当前登录以开发用匿名登录为主；手机号验证码 / Magic Link 仍需后续对齐 `docs/05`
- PWA（含 Service Worker、推送）是明确目标，但当前仓库尚未完整接入

**下一步：** 按 `HANDOVER.md` 与 `docs/11` 的差距清单推进：优先安全规则与真实链路验收，再补齐注册登录、PWA 与占位模块。
