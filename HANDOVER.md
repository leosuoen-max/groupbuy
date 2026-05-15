# 会话交接 · 下一任助手请先读这里

> 仓库路径示例：`…/点餐小软件/groupbuy`（注意：**不要**打开名称里带多余空格的那份文件夹）。前端应用目录：**`groupbuy/web/`**，Firebase 环境变量必须在 **`web/.env.local`**（与 `web/package.json` 同级）。

---

## 本文件的读写约定（何时读 / 何时改 / 怎么改）

### 什么时候「读」HANDOVER

建议在下列时机让人（或 AI）**主动打开阅读**，Cursor **不会**自动替你读：

| 场景 | 说明 |
|------|------|
| **新开聊天**且本轮任务要写/改本仓库代码 | 首条消息写一句：`请先读仓库根目录 HANDOVER.md`，或在 Cursor 规则里固定这句 |
| **隔几周再来**、记不清现状 | 先读本文件第二节再动手 |
| **交接给别人**（同事、另一个助手） | 让对方按本文「五、交接用语」复制启动 |
| **只想快速找入口**（例如 Firebase env、顾客订单写在哪） | 读第二节 + 需要时再点进链接的文件 |

**不必读**：纯改错别字、只动单个组件样式且你很确定架构没变——可按需跳过。

---

### 什么时候「改」HANDOVER

**不要求**每次提交代码都改文档。下面是「建议更新第二节（现状摘要）」的典型时机：

| 建议更新 | 举例 |
|----------|------|
| **数据写到哪里变了** | 例如订单从本地缓存改为只写 Firestore |
| **默认行为变了** | 例如 ShopHome 默认 Firestore / `?mock=1` 才演示 |
| **认证或规则策略变了** | 匿名 → 手机号、Storage/Firestore 规则大类调整 |
| **完成一个可交接的里程碑** | 打通「下单→截图→商户核实」等，第二节句子过时了就改 |
| **第三节「下一步」里某条已做完** | 删掉或改成下一优先级 |

**可以不改 HANDOVER、改别处即可**：仅修 bug、微调 UI、小重构且不影响「别人从哪里上手」——可选只写 commit message；若细节很重要，改 **`docs/`** 或 **`README`** 也行。

---

### 怎么「改」（写法规矩）

1. **第二节**：只写**短句 + 路径/模块名**，描述「**现在**仓库是什么样」；不写教程步骤。  
2. **第三节**：保持 **3～5 条**真实优先级，**删掉已完成项**，避免长期堆成历史记录。  
3. **不替代 `docs/`**：数据字段、产品规则以 **`docs/06`、`docs/08` 等**为准；HANDOVER 只做**摘要和指针**。  
4. **改完请提交 Git**，message 建议带前缀：`docs:` 或 `chore(docs): 更新 HANDOVER — 简要说明`。

---

## 一、请先按顺序阅读的文件

| 顺序 | 路径 | 说明 |
|:----:|------|------|
| 1 | `README.md` | 产品一句话定位、技术栈、路由结构 |
| 2 | `CURSOR_GUIDE.md` | Cursor 建议的阅读顺序与开发顺序 |
| 3 | `HANDOVER.md` | **本文件**：仓库现状摘要（需随里程碑更新） |
| 4 | `docs/08-第一版范围.md` | MVP 做/不做（产品目标） |
| 5 | `docs/11-需求与实现对照.md` | **路由/数据源与 docs/08 对照（代码事实）** |
| 6 | `docs/06-数据模型.md` | Firestore 集合与字段 |
| 7 | `docs/03-顾客端功能.md` | 顾客端需求细节 |
| 8 | `docs/04-商户后台功能.md` | 商户端需求细节 |
| 9 | `docs/07-技术方案.md` | 路由与技术选型 |

开发细节不确定时，继续查 **`docs/10-设计原则.md`**。

---

## 二、当前仓库里「我们已经做了什么」（摘要）

**详细路由表、数据源与「docs/08 清单 vs 代码」逐项对照**：请读 **`docs/11-需求与实现对照.md`**（里程碑后记得同步更新该文档）。

**一句话**：`groupbuy/web` + Firebase（`web/.env.local`）；顾客端 **`ShopHome` 默认 Firestore**（`?mock=1` 演示）、订单 **`orders`** + 付款截图 **Storage**；商户端 **`Login` 匿名开发**、项目 **`projects`**、订单管理/对账/凭证已接库、**Dashboard 今日三格统计**；近期已落地：订单页返回选菜保留草稿、商户“免提交付款凭证”（首单/加购）、对账单按凭证时间（分钟粒度）筛选并支持“按当前筛选一键确认待确认”、商户侧术语统一为“待确认/待付款”——以 **`docs/11`** 第三节为准。

### 需用户在本机 / Firebase 控制台完成的事项

- **Authentication**：按需启用匿名登录（商户调试）；生产按 **`docs/05`** 收紧。
- **Firestore / Storage**：部署或测试规则；**切勿长期对生产环境使用「全库可读可写」类临时规则**。
- **`web/.env.local`**：六个 `VITE_FIREBASE_*`；勿提交 Git（见 `.gitignore`）；修改后重启 `npm run dev`。

---

## 三、建议的「下一步」（优先级）

按 **上线与真实使用** 优先，其次才是新功能。

1. **安全与上线**：收紧 **Firestore / Storage** 规则；按 **`docs/08`**「上线判断标准」在微信/WhatsApp、商户 PWA 场景跑通全流程。
2. **权限升级**：Dashboard / 订单列表等仍主要为「创建人」校验；若要让高级管理员进入，统一走 **`permissionService`** 与店铺级判定。
3. **占位模块**：`ShopSettings`、`Register`、分享卡、PWA 等与 **`docs/11`** 对齐 roadmap。
4. **文档同步**：功能大改后更新 **`docs/11`**（首选）、必要时改 **`HANDOVER` 第二节**；**不要**仅改 `docs/08` 的 `[x]` 来代表实现状态。

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
请读 groupbuy 根目录的 HANDOVER.md、README.md、CURSOR_GUIDE.md、docs/11-需求与实现对照.md，再按需补读 docs/06、docs/03/04。
当前前端在 web/；详细路由与实现差距以 docs/11 为准。
请结合 HANDOVER「三、建议的下一步」与本条任务描述继续。
```

（把路径换成本机实际路径；任务描述写清要做的具体事。）

---

*若与代码不一致，以仓库内代码与 `docs/` 为准；本文件应在里程碑或架构变更后人工更新。*

---

## 六、饭团相关进展（约 2026-05，给下一任）

本节为**阶段性交接摘要**；支付组口径仍以 **`docs/CONSTITUTION_支付组.md`**、代码与 **`web/src/lib/paymentGroups.ts`** 为准。后端统一查询、索引与运营能力见 **`docs/14-饭团订单支付后端后续.md`**（刻意未在本轮实现）。

### 本轮已落地（摘要）

- **顾客侧**：饭团订单列表/详情与身份查询对齐（`customerKey` / `customerUserId` / 微信会话等，以代码为准）；饭团钱包顾客端与管理员端有过 UI 增强。
- **饭团后台订单列表**：`FeituanOrders` 向商户 `OrderManagement` 靠齐（筛选、标签、空状态、排序、入口）；列表**不做**支付组确认，确认进详情。
- **商户/饭团后台订单详情**：`MerchantOrderDetail` 支付组展示与确认统一走 **`buildPaymentGroups`**，与「宪法」一致。
- **饭团对账页**：`FeituanReconciliation` 扩展为金额对账 / 生产统计 / 成本利润（复用 `reconciliationSummary` / `reconciliationProfit` 等），含筛选、复制、CSV；时间筛选含凭证与钱包/次卡自动确认时间（见该页说明文案）。
- **饭团顾客项目页**：`FeituanProject` 顾客模式复用商户端 `ShopHeader`、`ShopProjectStatusCard`、`ShopContentBlocks`、`ProductCard` 等布局；头图**隐藏**分享/更多；套餐保留长方形「选择/收起」、搭配项配图且压低高度；主题色与商户一致为**绿色行动色**（`#08c279` 等）。
- **饭团首页**：`FeituanHome` 保留暖色与橙色品牌点缀，主要行动提示与点击态偏**绿色**，减轻首页进详情页的色差冲击。
- **饭团管理**：项目卡片可「查看项目」；路由 **`/admin/feituan/project/:projectId`** 为管理员只读预览（`FeituanProject` 的 `adminPreview`），审批前可看全量内容。

### 主要涉及文件（入口）

| 区域 | 路径 |
|------|------|
| 饭团顾客项目页 | `web/src/pages/FeituanProject.tsx` |
| 饭团首页 | `web/src/pages/FeituanHome.tsx` |
| 复用顾客端组件 | `web/src/components/customer/ShopHeader.tsx`、`ShopProjectStatusCard.tsx`、`ProductCard.tsx` |
| 饭团后台订单列表 | `web/src/pages/FeituanOrders.tsx` |
| 饭团对账 | `web/src/pages/FeituanReconciliation.tsx` |
| 饭团管理 + 预览路由 | `web/src/pages/FeituanAdmin.tsx`、`web/src/appRoutes.tsx` |
| 支付组 / 对账计算 | `web/src/lib/paymentGroups.ts`、`reconciliationGroups.ts`、`reconciliationSummary.ts`、`reconciliationProfit.ts` 等 |

### 刻意未做 / 延后

- **第二步**：饭团后台与商户侧「统一后端查询、索引、统计、权限审计」等——见 **`docs/14-饭团订单支付后端后续.md`**，**未**在本轮实现。
- **「驳回某组支付」**：产品决定不做（凭证支付过渡方案）。
- **HANDOVER 第二节**：未逐句合并进上文「一句话」摘要；若你希望总览永远最新，可择机把本节要点**压缩进第二节**并删掉本节重复句。

### 与线上一场可能不一致的仓库内容（一般不用为对齐而改代码）

- **`docs/13-微信服务号接入.md`** 等文档中的 **示例域名**（如 `*.web.app`）可能不等于你们当前生产域名；以**实际部署与公众号菜单**为准，文档按需人工更新即可。
- **`web/src/data/mockShopHome.ts`** 等 mock 仅演示；真数据来自 Firestore。
- **`firebase-debug.log`**（若本机存在）：勿提交；可团队约定加入 `.gitignore`。

### 下一任建议起手顺序

1. 读 **`docs/11`** 与 **`docs/14`**，确认本轮是否已覆盖你们当前优先级。
2. 改饭团订单/对账前，先确认 **`buildPaymentGroups`** 与相关 lib 测试（若有）。
3. 改 **`ShopHeader` / `ProductCard` / `ShopProjectStatusCard`** 时顺带打开商户 **`ShopHome`** 回归，避免共享组件误伤商户端。
