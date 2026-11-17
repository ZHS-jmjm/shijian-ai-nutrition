# 食鉴 · AI 营养分析师

「食鉴」是一个饮食与运动记录网站：上传一张餐食照片或输入文字，AI 会生成营养分析报告（热量、三大营养素、评分与建议），并支持营养师对话、每日摄入追踪和运动记录。

前端使用原生 HTML / CSS / JavaScript，后端使用 Express + MySQL，AI 能力通过兼容 OpenAI `/chat/completions` 协议的接口接入（默认适配 DeepSeek）。

## 功能

- **AI 餐食分析**：图片或文字输入，生成评分、热量与营养素报告，可一键加入当天摄入
- **营养师对话**：回答时自动结合当天已记录的摄入与每日热量目标
- **今日摄入**：餐食明细、删除记录、调整每日目标
- **运动中心**：记录运动并按周统计消耗（保存在浏览器本地）
- **账号体系**：注册 / 登录 / 会话（服务端 MySQL 持久化）

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | HTML、CSS、原生 JavaScript（无构建步骤） |
| 后端 | Node.js + Express |
| 数据库 | MySQL 8（首次启动自动建库建表） |
| AI | 兼容 OpenAI 协议的接口（默认 DeepSeek） |

## 目录结构

```
├─ index.html            登录页
├─ register.html         注册页
├─ home.html             首页（今日概览）
├─ nutrition.html        AI 营养师（餐食分析）
├─ chat.html             营养师对话
├─ tracker.html          今日摄入
├─ exercise.html         运动中心
├─ css/                  样式
├─ js/                   页面脚本与接口封装
├─ image/                静态图片
└─ server/               后端（Express + MySQL）
   ├─ server.js          路由与静态托管
   ├─ db.js              连接池、建库建表、演示账号
   ├─ local-db.js        便携环境下的本地 MySQL 启动
   └─ .env.example       环境变量模板
```

## 本地启动

### 1. 准备环境

- Node.js（含 npm，18 及以上）
- MySQL 8（正在运行，账号需具备建库建表权限）

### 2. 配置环境变量

```bash
cd server
cp .env.example .env
```

编辑 `server/.env`，按实际环境填写：

```ini
APP_PORT=3000

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=你的数据库密码
DB_NAME=shijian_nutrition

# 留空则使用演示数据；填写后调用真实模型
AI_API_KEY=
AI_BASE_URL=https://api.deepseek.com/v1
AI_MODEL=deepseek-flash
```

### 3. 安装依赖并启动

```bash
cd server
npm ci
npm start
```

启动后访问 [http://localhost:3000](http://localhost:3000)，演示账号 `test / 123456`，也可以在登录页注册。

首次启动会自动创建数据库与数据表，通常无需手动执行 SQL。若需要导入备份，可在首次启动前把包含 `CREATE DATABASE shijian_nutrition` 语句的逻辑备份放到 `database/migration.sql`。

## AI 配置说明

- `AI_API_KEY` 留空时，餐食分析与对话走内置演示数据，方便离线体验
- 接入真实模型时填写 `AI_API_KEY`；餐食照片分析要求模型支持图片输入
- 模型通过 `AI_BASE_URL` + `AI_MODEL` 指定，任何兼容 OpenAI `/chat/completions` 的服务都可以接入
- 推理型模型（如 `deepseek-flash`）的思考过程会占用输出配额，`AI_MAX_TOKENS` 建议不低于 3000

## 数据存储

- 用户、会话、摄入明细、分析历史：MySQL
- 运动记录：浏览器 localStorage，按账号区分
- 运动消耗与 AI 营养数据均为估算值，仅供参考，不构成医学建议

## 安全提示

`server/.env` 内含数据库密码与 AI 密钥，已被 `.gitignore` 排除，**请勿提交到仓库**。仓库中只保留 `.env.example` 模板。

## 更新运动页样式

运动页使用本地生成的 `css/exercise-utilities.css`。修改运动页使用的 Tailwind 类名后，在项目根目录运行：

```cmd
npx tailwindcss@3.4.17 --content "exercise.html,js/exercise.js,js/auth.js,js/global-ui.js" --output css/exercise-utilities.css
```

---

本项目为课程实践作品，AI 估算结果不构成任何医疗或营养学建议。
