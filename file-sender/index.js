const fs = require('fs');
const path = require('path');

module.exports.name = 'file-sender';

module.exports.apply = (ctx) => {
  const logger = ctx.logger('file-sender');

  // 本地文件存储目录：koishi根目录/data/files
  const fileDir = path.resolve(ctx.baseDir, 'data/files');
  
  // 确保目录存在
  if (!fs.existsSync(fileDir)) {
    try {
      fs.mkdirSync(fileDir, { recursive: true });
      logger.info(`已自动创建文件存储目录: ${fileDir}`);
    } catch (e) {
      logger.error(`无法创建存储目录: ${e.message}`);
    }
  }

  ctx.command('发送文件 <filename:string>', '发送指定的本地文件，例如 PDF 等')
    // 快捷方式：当用户发送“校历”时，等同于执行“发送文件 校历.pdf”
    .shortcut('校历', { fuzzy: true, args: ['校历.pdf'] })
    // 快捷方式：当用户发送“地图”时，等同于执行“发送文件 地图.pdf”
    .shortcut('地图', { fuzzy: true, args: ['地图.pdf'] })
    // 快捷方式：当用户发送“好东西”时，等同于执行“发送文件 好东西.pdf”
    .shortcut('好东西', { fuzzy: true, args: ['好东西.pdf'] })
    .action(async ({ session }, filename) => {
      if (!filename) {
        return '请输入文件名。例如：发送文件 manual.pdf';
      }

      const filePath = path.resolve(fileDir, filename);

      // 安全检查：防路径穿越攻击
      if (!filePath.startsWith(fileDir)) {
        return '错误：非法的文件路径！';
      }

      if (!fs.existsSync(filePath)) {
        return `未找到该文件，请确保它已被放入目录中`;
        // ：\n${fileDir}
      }

      logger.info(`正在通过 OneBot API 为用户 ${session.userId} 发送文件: ${filename} (路径: ${filePath})`);

      try {
        // 判断私聊还是群聊，分别调用对应的 OneBot 接口进行物理文件上传/发送
        if (session.subtype === 'private') {
          await session.bot.internal.uploadPrivateFile(session.userId, filePath, filename);
        } else {
          // 群聊中上传文件 (参数依次是：群号、本地绝对路径、展示在群文件里的文件名)
          await session.bot.internal.uploadGroupFile(session.guildId, filePath, filename);
        }
        return; // 由内部 API 处理发送，无需在此返回消息段
      } catch (err) {
        logger.error(`发送文件失败: ${err.stack || err.message || err}`);
        return `文件发送失败: ${err.message || err}`;
      }
    });
};
