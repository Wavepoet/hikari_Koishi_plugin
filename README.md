# Hikari Koishi Plugins

自用的 Koishi 插件及 Docker 部署配置。

## 插件列表

- **custom-mute**: 自定义群聊禁言插件，支持通过 @ 机器人进行禁言管理。
- **file-sender**: 本地文件发送器，通过 OneBot API 发送本地目录下的指定文件（如 PDF 等）。
- **local-pic-sender**: 本地文件发送器，读取本地目录中的文件并发送，支持自定义路径与响应模式。

## 部署与运行

Docker Compose 配置，集成 NapCat 和 Koishi但插件未写入：

- **NapCat WebUI**: `http://localhost:6099`
- **Koishi 控制台**: `http://localhost:5140`
