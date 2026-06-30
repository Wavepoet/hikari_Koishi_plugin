const fs = require('fs');
const path = require('path');
const { Schema } = require('koishi');

module.exports.name = 'file-sender';

module.exports.Config = Schema.object({
  fileDir: Schema.string().default('data/files').description('本地文件存储目录，相对路径或绝对路径'),
  shortcuts: Schema.array(Schema.object({
    trigger: Schema.string().required().description('触发指令/快捷文本（例如：校历）'),
    targetFile: Schema.string().required().description('目标文件名（例如：校历.pdf）'),
    fuzzy: Schema.boolean().default(true).description('是否开启模糊匹配/模糊快捷方式'),
  })).role('table').default([
    { trigger: '校历', targetFile: '校历.pdf', fuzzy: true },
    { trigger: '地图', targetFile: '地图.pdf', fuzzy: true },
    { trigger: '好东西', targetFile: '好东西.pdf', fuzzy: true },
  ]).description('快捷触发规则列表，用户发送快捷文本时将自动发送对应的目标文件'),
});

module.exports.apply = (ctx, config) => {
  const logger = ctx.logger('file-sender');

  // 本地文件存储目录
  const targetDir = path.resolve(ctx.baseDir, config.fileDir || 'data/files');
  
  // 确保目录存在
  if (!fs.existsSync(targetDir)) {
    try {
      fs.mkdirSync(targetDir, { recursive: true });
      logger.info(`已自动创建文件存储目录: ${targetDir}`);
    } catch (e) {
      logger.error(`无法创建存储目录: ${e.message}`);
    }
  }

  const cmd = ctx.command('发送文件 <filename:string>', '发送指定的本地文件，例如 PDF 等');

  // 动态注册快捷方式
  if (config.shortcuts && Array.isArray(config.shortcuts)) {
    for (const item of config.shortcuts) {
      if (item.trigger && item.targetFile) {
        cmd.shortcut(item.trigger, { fuzzy: item.fuzzy ?? true, args: [item.targetFile] });
      }
    }
  }

  cmd.action(async ({ session }, filename) => {
    if (!filename) {
      return '请输入文件名。例如：发送文件 manual.pdf';
    }

    const filePath = path.resolve(targetDir, filename);

    // 安全检查：防路径穿越攻击
    if (!filePath.startsWith(targetDir)) {
      return '错误：非法的文件路径！';
    }

    if (!fs.existsSync(filePath)) {
      return `未找到该文件，请确保它已被放入目录中`;
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
