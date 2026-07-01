# Hikari Koishi Plugins

自用的 Koishi 插件及 Docker 部署配置。

## 插件列表

- **custom-mute**: 自定义群聊禁言插件，支持通过 @ 机器人进行自定义时长的禁言管理。
- **file-sender**: 本地文件发送器，通过 OneBot API 发送本地目录下的指定文件（如 PDF 等），并支持通过快捷词触发和展示动态文件列表（`file help`）。
- **local-pic-sender**: 本地图片发送器，读取本地目录中的图片文件并发送，支持自定义路径与响应模式。
- **mutual-unmute**: 群聊互助解禁插件，支持被禁言用户私信机器人提交解禁申请，再由同群的其他成员在群内发送 `@机器人 remove` 协助解除禁言。

## 部署与运行

使用 Docker Compose 进行快速部署，配置集成了 NapCat (OneBot 11) 和 Koishi 机器人框架：

- **NapCat WebUI**: `http://localhost:6099`
- **Koishi 控制台**: `http://localhost:5140`
