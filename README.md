<div align="center">

<img width="1820" height="1024" alt="Group 343" src="https://github.com/user-attachments/assets/782dda02-7851-4619-8040-2575ac040799" />


# BananaPod ｜ 香蕉铺子 ｜ ZHO

</div>

<img width="1650" height="1777" alt="Group 345" src="https://github.com/user-attachments/assets/b78176f1-8c1e-4154-b330-7d0c16559bfb" />

## 🆕 全新 UI 、iPad/Apple Pencil 手绘支持、视频模式 和 新功能上线！



### 1）高级质感 UI + 新功能

<img width="1955" height="2029" alt="Group 378" src="https://github.com/user-attachments/assets/9d46f99a-3ecb-4b59-a611-03742257b0eb" />

  ✅局部重绘
  
  ✅提示词储存/复用系统
  
  ✅UI 支持高度定制化
  
  ✅中英双界面
  
  ✅多画板系统
  
  ✅图层系统
  
  ✅图片编辑系统
  
  ✅图片圆角

  
### 2）视频生成模式

https://github.com/user-attachments/assets/ab3742a4-52be-491d-86b3-78607db10d1e


### 3）iPad/Apple Pencil 手绘支持

<img width="3427" height="2294" alt="Group 407" src="https://github.com/user-attachments/assets/6af0b69c-ac6c-4664-adbe-3cff6de04799" />

<img width="2702" height="1814" alt="Group 405" src="https://github.com/user-attachments/assets/1fc2c57f-aa95-4364-8974-f6eb3bbb8a19" />


https://github.com/user-attachments/assets/980c2774-62ca-4730-984f-72531b595d5e



  




## 免提示词，内置玩法轻松选，一键构建创意画板

我的 Nano Banan 创意玩法大全：[Nano-Banana Creation ZHO](https://github.com/ZHO-ZHO-ZHO/ZHO-nano-banana-Creation)


### 功能主要包含两部分：

1）生成/编辑部分：支持多图框选 + 选择玩法直接生成/编辑

2）绘制部分，方便标注和手绘图作为输入



https://github.com/user-attachments/assets/83c96432-4246-4c1c-9087-6d0669acdaed




与 [香蕉超市｜Nano Bananary](https://github.com/ZHO-ZHO-ZHO/Nano-Bananary) 区别：

**1️⃣ 香蕉铺子｜BananaPod**

创作白板/画布

适合创意专业用户

方便多维度生成 构建灵感+创意体系


**2️⃣ 香蕉超市｜Nano Bananary**

窗口式玩法大全

适合所有用户

方便效果直出+连续编辑


# Online

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1CsvkMqNnxdUrmJZYeSXNZDf6T1Yq2qQW

## Run Locally

**Prerequisites:** Node.js


1. Install dependencies:
   `npm install`
2. Build once (Worker serves `dist/` as static assets):
   `npm run build`
3. Run the Worker locally (recommended):
   `npm run dev:worker`

> 说明：本项目已改为 **Cloudflare Worker 代调用 Gemini**。前端不再直连 Google API，直接跑 `npm run dev`（Vite）默认不会带上 Worker 的 `/api/*`。本地开发建议用 `wrangler dev`。

## Deploy to Cloudflare Worker + R2 + D1 + KV

### 1) 创建云资源

1. **创建 KV（用户 allowlist + session）**：
   - `wrangler kv namespace create USERS_KV`
2. **创建 R2 桶（生成媒体存储）**：
   - `wrangler r2 bucket create <your-r2-bucket-name>`
3. **创建 D1 数据库（历史记录）**：
   - `wrangler d1 create <your-d1-name>`
4. **应用 D1 迁移**：
   - `wrangler d1 migrations apply <your-d1-name>`

### 2) 配置 `wrangler.toml`

编辑 [`wrangler.toml`](wrangler.toml)，把以下占位符替换成你自己的：
- KV：`REPLACE_WITH_KV_NAMESPACE_ID`
- R2：`REPLACE_WITH_R2_BUCKET_NAME`
- D1：`REPLACE_WITH_D1_DB_NAME` / `REPLACE_WITH_D1_DB_ID`

### 3) 配置 Gemini Key（Worker 端统一密钥）

在项目根目录执行：
- `wrangler secret put GEMINI_API_KEY`

### 3.1) （可选）配置 BASE_URL

默认会使用：`https://generativelanguage.googleapis.com`  
如果你有代理/网关/自建转发，可以在 [`wrangler.toml`](wrangler.toml) 的 `[vars]` 里设置：
- `BASE_URL = "https://your-base-url"`

### 4) 写入允许访问的 userKey（明文）

这个版本按你的要求：**KV 里直接存明文 userKey**，值为 `1` 表示允许：
- `wrangler kv:key put --binding USERS_KV "<userKey>" "1"`

### 5) 部署

1. 构建：`npm run build`
2. 部署：`npm run deploy`

### 6) 使用方式

进入网页后输入你的 **userKey**（每个用户自己的访问密钥），前端会存到 localStorage，并由 Worker 下发 session cookie：
- **生成的图片/视频**：存入 R2
- **历史记录**：存入 D1，可在 History 面板查看/插入/删除



## 更新日志

- 20250925

  全新 UI 、iPad/Apple Pencil 手绘支持、视频模式 和 新功能上线

  ✅局部重绘
  
  ✅提示词储存/复用系统
  
  ✅UI 支持高度定制化
  
  ✅中英双界面
  
  ✅多画板系统
  
  ✅图层系统
  
  ✅图片编辑系统
  
  ✅图片圆角

- 20250908
  
  创建项目 + 基础功能一步到位 + 内置玩法大全
  

## Stars 

[![Star History Chart](https://api.star-history.com/svg?repos=ZHO-ZHO-ZHO/BananaPod&type=Date)](https://star-history.com/#ZHO-ZHO-ZHO/BananaPod&Date)


## 关于我 | About me

📬 **联系我**：
- 邮箱：zhozho3965@gmail.com
  

🔗 **社交媒体**：
- 个人页：[-Zho-](https://jike.city/zho)
- Bilibili：[我的B站主页](https://space.bilibili.com/484366804)
- X（Twitter）：[我的Twitter](https://twitter.com/ZHO_ZHO_ZHO)
- 小红书：[我的小红书主页](https://www.xiaohongshu.com/user/profile/63f11530000000001001e0c8?xhsshare=CopyLink&appuid=63f11530000000001001e0c8&apptime=1690528872)

💡 **支持我**：
- B站：[B站充电](https://space.bilibili.com/484366804)
- 爱发电：[为我充电](https://afdian.com/a/ZHOZHO)


## Credits

[Gemini 2.5 Flash Image](https://gemini.google.com/app)
