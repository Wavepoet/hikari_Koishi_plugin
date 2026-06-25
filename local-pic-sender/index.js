const fs = require('fs');
const path = require('path');
const { h, Schema } = require('koishi');

module.exports.name = 'local-pic-sender';

module.exports.Config = Schema.object({
  path: Schema.string().default('data/images').description('本地图片存储目录路径（支持绝对路径，或相对于 koishi 根目录的相对路径）'),
  onlyEmpty: Schema.boolean().default(true).description('是否仅在只 @ 机器人（即没有其他文本内容）时触发'),
  atResponse: Schema.boolean().default(false).description('发送图片时是否同时 @ 触发者'),
});

module.exports.apply = (ctx, config) => {
  const logger = ctx.logger('local-pic-sender');

  // 监听并确保图片文件夹存在
  const resolvePath = (p) => {
    return path.isAbsolute(p) ? p : path.resolve(ctx.baseDir, p);
  };

  const imgDir = resolvePath(config.path);
  if (!fs.existsSync(imgDir)) {
    try {
      fs.mkdirSync(imgDir, { recursive: true });
      logger.info(`已自动创建本地图片目录: ${imgDir}`);
    } catch (e) {
      logger.error(`无法创建本地图片目录: ${e.message}`);
    }
  }

  ctx.middleware(async (session, next) => {
    // 必须有消息内容
    if (!session.content) return next();

    // 检查是否 @ 了机器人 (支持真正的 at 元素以及文本匹配)
    let isAtBot = session.elements?.some(el => el.type === 'at' && el.attrs?.id === session.selfId);
    const botId = session.selfId;
    const nickname = session.bot?.username;
    const rawContent = session.content;

    if (!isAtBot) {
      if (rawContent.includes(`@${botId}`)) {
        isAtBot = true;
      } else if (nickname && rawContent.includes(`@${nickname}`)) {
        isAtBot = true;
      }
    }

    // 如果没有 @ 机器人，则不处理，流转给下一个中间件
    if (!isAtBot) return next();

    // 提取并清理除 @机器人 以外的纯文本内容
    let contentText = '';
    if (session.elements) {
      contentText = session.elements
        .filter(el => {
          if (el.type === 'at' && el.attrs?.id === session.selfId) return false;
          return el.type === 'text';
        })
        .map(el => el.attrs?.content || '')
        .join('')
        .trim();
    } else {
      contentText = rawContent;
    }

    if (nickname) {
      contentText = contentText.replace(new RegExp(`@\\s*${nickname}`, 'g'), '');
    }
    contentText = contentText.replace(new RegExp(`@\\s*${botId}`, 'g'), '').trim();

    // 如果配置为 onlyEmpty 且除了 @ 以外还有其他文本内容，则不触发
    if (config.onlyEmpty && contentText.length > 0) {
      return next();
    }

    const currentImgDir = resolvePath(config.path);
    if (!fs.existsSync(currentImgDir)) {
      logger.warn(`本地图片目录不存在: ${currentImgDir}`);
      return next();
    }

    try {
      // 读取目录下的所有图片文件
      const files = fs.readdirSync(currentImgDir).filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext);
      });

      if (files.length === 0) {
        logger.warn(`在图片目录中没有找到图片: ${currentImgDir}`);
        // 返回友好提示
        return '图片库中还没有图片哦，请放入图片后再试。';
      }

      // 随机选取一张图片
      const randomFile = files[Math.floor(Math.random() * files.length)];
      const filePath = path.join(currentImgDir, randomFile);

      logger.info(`用户 ${session.userId} 触发随机图片发送: ${randomFile}`);

      const imgBuffer = fs.readFileSync(filePath);
      const ext = path.extname(randomFile).toLowerCase();
      let mimeType = 'image/jpeg';
      if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.gif') mimeType = 'image/gif';
      else if (ext === '.webp') mimeType = 'image/webp';
      else if (ext === '.bmp') mimeType = 'image/bmp';

      const imgElement = h('image', { url: `data:${mimeType};base64,${imgBuffer.toString('base64')}` });
      const payload = config.atResponse ? h.at(session.userId) + imgElement : imgElement;

      logger.info(`正在调用 session.send 发送图片...`);
      try {
        const sendResult = await session.send(payload);
        logger.info(`session.send 发送成功，结果: ${JSON.stringify(sendResult)}`);
      } catch (sendErr) {
        logger.error(`session.send 发生错误: ${sendErr.stack || sendErr.message || sendErr}`);
      }
      return;
    } catch (err) {
      logger.error(`随机图片发送失败: ${err.message}`);
      return next();
    }
  });
};
