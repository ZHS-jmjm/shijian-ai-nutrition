# 食鉴 · AI 营养分析师

「食鉴」是一个饮食和运动记录网站，提供图文餐食分析、营养师对话、每日摄入追踪和运动记录。前端使用 HTML、CSS 和原生 JavaScript，后端使用 Express 和 MySQL。

## 本地启动

Windows x64 迁移包包含 Node.js、MySQL 和后端依赖。请完整解压 ZIP，然后双击 `启动.bat`。首次启动会在项目内的 `.runtime/mysql-data` 初始化数据库。网站默认使用 3000 端口，数据库使用 3307 端口。如果端口被占用，可在 `server/.env` 中调整 `APP_PORT` 或 `DB_PORT`。

从源文件手动部署时，可按以下步骤配置。

1. 准备带 npm 的 Node.js 和正在运行的 MySQL。项目使用 Node.js 24 验证。
2. 在 `server/.env` 中配置 MySQL 连接。已有配置可直接使用。首次配置可复制 `server/.env.example`，然后按实际环境设置 `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD` 和 `DB_NAME`。连接账号需要有初始化数据库和表的权限。
3. Windows 上双击 `启动.bat`。首次运行会按锁定版本安装依赖，服务准备好后自动打开浏览器。也可以进入 `server` 目录执行 `npm ci` 和 `npm start`，然后访问 [localhost:3000](http://localhost:3000)。
4. 本地演示账号是 `test / 123456`，也可以在登录页注册账号。

服务首次启动会初始化数据库和数据表。通常无需手动执行 SQL。若要恢复现有备份，可按自己的数据恢复流程使用 `database` 目录下的脚本。

## AI 配置

后端从 `server/.env` 读取 `AI_API_KEY`、`AI_BASE_URL` 和 `AI_MODEL`，通过兼容 `/chat/completions` 的接口调用模型。使用餐食照片分析时，配置的模型需要支持图片输入。留空 `AI_API_KEY` 可使用演示报告和演示对话。

餐食分析生成一份报告，用户可选择把它加入当天摄入。营养师对话会读取发问时当天已记录的摄入和每日目标。AI 估算结果供参考，不构成医学建议。

## 数据存储

- 用户、登录会话、摄入明细及分析历史保存在 MySQL。
- 运动记录按账号保存在当前浏览器，运动消耗为估算值，可在运动中心、首页和今日摄入页查看。
- `server/.env` 和 `database` 目录供本地维护使用。请妥善保管其中的配置和备份。

## 更新运动页样式

运动页使用本地生成的 `css/exercise-utilities.css`。修改运动页使用的 Tailwind 类名后，在项目根目录运行以下命令重新生成样式。

```cmd
npx tailwindcss@3.4.17 --content "exercise.html,js/exercise.js,js/auth.js,js/global-ui.js" --output css/exercise-utilities.css
```
