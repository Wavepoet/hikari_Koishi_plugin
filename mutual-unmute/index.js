const { Schema } = require('koishi');

module.exports.name = 'mutual-unmute';

module.exports.Config = Schema.object({
  duration: Schema.number().default(3600).description('解禁申请有效期（单位：秒，默认 3600 秒/1 小时）'),
});

module.exports.apply = (ctx, config) => {
  const logger = ctx.logger('mutual-unmute');

  // 记录未处理的解禁申请。键为 userId，值为 { timestamp, nickname }
  const pendingRequests = new Map();

  ctx.middleware(async (session, next) => {
    const now = Date.now();
    const expireMs = (config.duration || 3600) * 1000;

    // 定期/在每次接收到消息时清理过期申请
    for (const [userId, req] of pendingRequests.entries()) {
      if (now - req.timestamp > expireMs) {
        pendingRequests.delete(userId);
      }
    }

    const rawContent = session.content || '';
    const userId = session.userId;

    // 1. 处理私聊申请解禁
    if (!session.guildId) {
      if (rawContent.trim() === 'remove禁言') {
        const nickname = session.sender?.nickname || session.sender?.username || userId;
        pendingRequests.set(userId, {
          timestamp: now,
          nickname: nickname,
        });
        logger.info('User %s (%s) registered unmute request', userId, nickname);
        return '已收到您的解除禁言申请！请让群聊成员在群里发送 @机器人 remove 来帮您解除禁言。';
      }
      return next();
    }

    // 2. 处理群聊内互助解禁
    // 检查是否 @ 了机器人
    let isAtBot = session.elements?.some(el => el.type === 'at' && el.attrs?.id === session.selfId);
    const botId = session.selfId;
    const nickname = session.bot?.username;

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

    // 判断指令是否为 remove
    if (content.toLowerCase() === 'remove') {
      if (pendingRequests.size === 0) {
        return '当前没有待解除禁言的申请。';
      }

      logger.info('Group %s requested removal of mutes. Pending users size: %d', session.guildId, pendingRequests.size);

      const unmutedUsers = [];
      for (const [pUserId, req] of pendingRequests.entries()) {
        try {
          // 禁言 0 秒即为解除禁言
          await session.bot.muteGuildMember(session.guildId, pUserId, 0);
          unmutedUsers.push(req.nickname);
          pendingRequests.delete(pUserId); // 成功解除后从申请列表中移除
          logger.info('Successfully unmuted user %s in guild %s', pUserId, session.guildId);
        } catch (error) {
          // 如果失败（通常是因为该用户不在此群中），仅记录日志，暂不移除申请，等待正确群聊中的人解禁
          logger.warn('Failed to unmute user %s in guild %s: %s', pUserId, session.guildId, error.message || error);
        }
      }

      if (unmutedUsers.length > 0) {
        return `已成功为以下用户解除禁言：\n${unmutedUsers.join('，')}`;
      } else {
        return '未能解除任何禁言。请检查机器人在此群是否拥有管理员权限，或申请解禁的用户是否在此群中。';
      }
    }

    return next();
  });
};
