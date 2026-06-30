const fs = require('fs');
const path = require('path');
const { h, Schema } = require('koishi');

module.exports.name = 'local-pic-sender';

module.exports.Config = Schema.object({
  path: Schema.string().default('data/images').description('本地图片存储目录路径（支持绝对路径，或相对于 koishi 根目录的相对路径）'),
  onlyEmpty: Schema.boolean().default(true).description('是否仅在只 @ 机器人（即没有其他文本内容）时触发'),
  atResponse: Schema.boolean().default(false).description('发送图片时是否同时 @ 触发者'),
});

// Helper to download an image from URL
async function downloadImage(ctx, url) {
  if (typeof ctx.http?.file === 'function') {
    try {
      const result = await ctx.http.file(url);
      return {
        buffer: Buffer.from(result.data),
        mime: result.mime,
      };
    } catch (e) {
      // Fallback
    }
  }

  if (typeof ctx.http?.get === 'function') {
    try {
      const data = await ctx.http.get(url, { responseType: 'arraybuffer' });
      return {
        buffer: Buffer.from(data),
        mime: null,
      };
    } catch (e) {
      // Fallback
    }
  }

  const res = await fetch(url);
  const ab = await res.arrayBuffer();
  return {
    buffer: Buffer.from(ab),
    mime: res.headers.get('content-type'),
  };
}

// Helper to guess file extension
function getExtension(buffer, mime, url) {
  if (mime) {
    if (mime.includes('png')) return '.png';
    if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
    if (mime.includes('gif')) return '.gif';
    if (mime.includes('webp')) return '.webp';
    if (mime.includes('bmp')) return '.bmp';
  }

  if (url) {
    const cleanUrl = url.split('?')[0].split('#')[0];
    const ext = path.extname(cleanUrl).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) {
      return ext === '.jpeg' ? '.jpg' : ext;
    }
  }

  if (buffer && buffer.length > 4) {
    const hex = buffer.toString('hex', 0, 4).toUpperCase();
    if (hex.startsWith('89504E47')) return '.png';
    if (hex.startsWith('FFD8FF')) return '.jpg';
    if (hex.startsWith('47494638')) return '.gif';
    if (hex.startsWith('52494646')) return '.webp';
    if (hex.startsWith('424D')) return '.bmp';
  }

  return '.jpg';
}

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

    // 1. 判断是否是上传指令
    const isUpload = /^\/上传(\s|$)/.test(contentText);
    if (isUpload) {
      const imgElements = session.elements?.filter(el => el.type === 'image' || el.type === 'img') || [];
      if (imgElements.length === 0) {
        return '错误：未检测到图片，请在消息中包含图片一并发送。';
      }

      const targetDir = resolvePath(config.path);
      if (!fs.existsSync(targetDir)) {
        try {
          fs.mkdirSync(targetDir, { recursive: true });
        } catch (e) {
          logger.error(`无法创建本地图片目录: ${targetDir}, 错误: ${e.message}`);
          return '上传失败：无法创建本地图片存储目录。';
        }
      }

      let successCount = 0;
      let failCount = 0;

      for (const imgEl of imgElements) {
        const url = imgEl.attrs?.url || imgEl.attrs?.src;
        if (!url) {
          failCount++;
          continue;
        }

        try {
          const { buffer, mime } = await downloadImage(ctx, url);
          const ext = getExtension(buffer, mime, url);
          const fileName = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
          const savePath = path.join(targetDir, fileName);
          
          fs.writeFileSync(savePath, buffer);
          successCount++;
          logger.info(`成功保存上传的图片到: ${savePath}`);
        } catch (err) {
          logger.error(`下载或保存图片失败: ${err.message}`);
          failCount++;
        }
      }

      if (successCount > 0) {
        if (failCount > 0) {
          return `已成功上传 ${successCount} 张图片，但有 ${failCount} 张图片上传失败。`;
        }
        return `成功上传 ${successCount} 张图片到图库！`;
      } else {
        return `上传失败，下载图片出错或链接无效。`;
      }
    }

    // 2. 原本的随机图片发送功能
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
