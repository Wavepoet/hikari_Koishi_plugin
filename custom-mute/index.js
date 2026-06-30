const { Schema } = require('koishi');

module.exports.name = 'custom-mute';

module.exports.Config = Schema.object({
  rules: Schema.array(Schema.object({
    keyword: Schema.string().required().description('触发关键词（例如：睡一课间）'),
    duration: Schema.number().required().description('禁言时长（单位：秒）'),
  })).role('table').default([
    { keyword: '睡一课间', duration: 600 },
    { keyword: '睡一节课', duration: 2400 },
    { keyword: '小睡一会', duration: 7200 },
    { keyword: '精致睡眠', duration: 28800 },
    { keyword: '大睡特睡', duration: 86400 }
  ]).description('禁言规则列表，支持自由配置关键词和对应的禁言时长。'),
});

module.exports.apply = (ctx, config) => {
  const logger = ctx.logger('custom-mute');

  ctx.middleware(async (session, next) => {
    // 只能在群聊（guild）中使用
    if (!session.guildId) return next();

    // 检查是否 @ 了机器人 (支持真正的 at 元素以及文本匹配)
    let isAtBot = session.elements?.some(el => el.type === 'at' && el.attrs?.id === session.selfId);
    
    const botId = session.selfId;
    const nickname = session.bot?.username;
    const rawContent = session.content || '';

    if (!isAtBot) {
      if (rawContent.includes(`@${botId}`)) {
        isAtBot = true;
      } else if (nickname && rawContent.includes(`@${nickname}`)) {
        isAtBot = true;
      }
    }

    if (!isAtBot) return next();

    // 提取并清理纯文本内容
    let content = '';
    if (session.elements) {
      content = session.elements
        .filter(el => {
          if (el.type === 'at' && el.attrs?.id === session.selfId) return false;
          return el.type === 'text';
        })
        .map(el => el.attrs?.content || '')
        .join('')
        .trim();
    } else {
      content = rawContent;
    }

    if (nickname) {
      content = content.replace(new RegExp(`@\\s*${nickname}`, 'g'), '');
    }
    content = content.replace(new RegExp(`@\\s*${botId}`, 'g'), '').trim();

    logger.info('Mute trigger content check: "%s"', content);

    let muteDuration = 0;
    let statementName = '';

    const rule = (config.rules || []).find(r => content.includes(r.keyword));
    if (rule) {
      muteDuration = rule.duration;
      statementName = rule.keyword;
    } else {
      // 没匹配到禁言语句，交由其他插件处理
      return next();
    }

    const targetId = session.userId;
    logger.info('Muting user %s in guild %s for %d seconds', targetId, session.guildId, muteDuration);
    
    try {
      // Koishi 的 muteGuildMember duration 单位是毫秒
      await session.bot.muteGuildMember(session.guildId, targetId, muteDuration * 1000);
      const targetName = session.sender?.nickname || session.sender?.username || targetId;
      
      // 格式化时间输出
      let durationText = '';
      if (muteDuration >= 3600) {
        durationText = `${muteDuration / 3600} 小时`;
      } else {
        durationText = `${muteDuration / 60} 分钟`;
      }
      
      return `已为 ${targetName} 开启【${statementName}】，禁言 ${durationText}。`;
    } catch (error) {
      logger.error('Failed to mute user: %s', error.message || error);
      if (error.message?.includes('permission') || error.code === 'permission-denied') {
        return `禁言失败：请检查机器人在此群是否拥有管理员权限。`;
      }
      return `禁言失败: ${error.message || error}`;
    }
  });
};
