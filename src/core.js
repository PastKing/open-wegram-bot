export function validateSecretToken(token) {
  return (
    token.length > 15 &&
    /[A-Z]/.test(token) &&
    /[a-z]/.test(token) &&
    /[0-9]/.test(token)
  );
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function postToTelegramApi(token, method, body) {
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function handleInstall(
  request,
  ownerUid,
  botToken,
  prefix,
  secretToken
) {
  if (!validateSecretToken(secretToken)) {
    return jsonResponse(
      {
        success: false,
        message:
          "Secret token must be at least 16 characters and contain uppercase letters, lowercase letters, and numbers.",
      },
      400
    );
  }

  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.hostname}`;
  const webhookUrl = `${baseUrl}/${prefix}/webhook/${ownerUid}/${botToken}`;

  try {
    const response = await postToTelegramApi(botToken, "setWebhook", {
      url: webhookUrl,
      allowed_updates: ["message"],
      secret_token: secretToken,
    });

    const result = await response.json();
    if (result.ok) {
      return jsonResponse({
        success: true,
        message: "Webhook successfully installed.",
      });
    }

    return jsonResponse(
      {
        success: false,
        message: `Failed to install webhook: ${result.description}`,
      },
      400
    );
  } catch (error) {
    return jsonResponse(
      { success: false, message: `Error installing webhook: ${error.message}` },
      500
    );
  }
}

export async function handleUninstall(botToken, secretToken) {
  if (!validateSecretToken(secretToken)) {
    return jsonResponse(
      {
        success: false,
        message:
          "Secret token must be at least 16 characters and contain uppercase letters, lowercase letters, and numbers.",
      },
      400
    );
  }

  try {
    const response = await postToTelegramApi(botToken, "deleteWebhook", {});

    const result = await response.json();
    if (result.ok) {
      return jsonResponse({
        success: true,
        message: "Webhook successfully uninstalled.",
      });
    }

    return jsonResponse(
      {
        success: false,
        message: `Failed to uninstall webhook: ${result.description}`,
      },
      400
    );
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        message: `Error uninstalling webhook: ${error.message}`,
      },
      500
    );
  }
}

export async function handleWebhook(request, ownerUid, botToken, secretToken) {
  if (secretToken !== request.headers.get("X-Telegram-Bot-Api-Secret-Token")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const update = await request.json();
  if (!update.message) {
    return new Response("OK");
  }

  const message = update.message;
  const reply = message.reply_to_message;
  try {
    if (reply && message.from.id.toString() === ownerUid) {
      const rm = reply.reply_markup;
      if (rm && rm.inline_keyboard && rm.inline_keyboard.length > 0) {
        await postToTelegramApi(botToken, "copyMessage", {
          chat_id: rm.inline_keyboard[0][0].callback_data,
          from_chat_id: message.chat.id,
          message_id: message.message_id,
        });
      }

      return new Response("OK");
    }

    if ("/start" === message.text) {
      return new Response("OK");
    }

    const sender = message.from;
    const senderUid = sender.id.toString();
    const senderName = sender.username
      ? `@${sender.username}`
      : [sender.first_name, sender.last_name].filter(Boolean).join(" ");

    const copyMessage = async function (withUrl = false) {
      // 获取消息类型和内容
      let msgType,
        contentInfo = "",
        fileId = "",
        messageText = "";

      if (message.photo) {
        msgType = "📷 图片";
        fileId = message.photo[message.photo.length - 1].file_id;
        contentInfo = message.caption ? `\n📝 说明：${message.caption}` : "";
        messageText = message.caption || "";
      } else if (message.video) {
        msgType = "🎥 视频";
        fileId = message.video.file_id;
        contentInfo = message.caption ? `\n📝 说明：${message.caption}` : "";
        messageText = message.caption || "";
      } else if (message.voice) {
        msgType = "🎤 语音";
        fileId = message.voice.file_id;
        contentInfo = message.caption ? `\n📝 说明：${message.caption}` : "";
        messageText = message.caption || "";
      } else if (message.document) {
        msgType = "📄 文件";
        fileId = message.document.file_id;
        contentInfo = `\n📝 文件名：${message.document.file_name}`;
        messageText = message.caption || "";
      } else if (message.sticker) {
        msgType = "🎯 贴纸";
        fileId = message.sticker.file_id;
        contentInfo = `\n📝 贴纸名：${message.sticker.set_name || "未知"}`;
        messageText = message.sticker.emoji || "";
      } else if (message.text) {
        msgType = "💬 文本消息";
        contentInfo = `\n📝 内容：${message.text}`;
        messageText = message.text;
      }

      // 构建发送时间
      const sendTime = new Date(message.date * 1000).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      });

      // 构建消息来源信息
      let sourceInfo = `${msgType}\n`;
      sourceInfo += `👤 来自: ${senderName}\n`;
      sourceInfo += `🆔 ID: ${senderUid}\n`;
      sourceInfo += `⏰ 发送时间: ${sendTime}`;
      if (message.forward_from) {
        sourceInfo += `\n↩️ 转发自: ${
          message.forward_from.first_name || message.forward_from.username
        }`;
      }
      sourceInfo += contentInfo;

      // 构建内联键盘按钮
      const ik = [
        [
          {
            text: withUrl ? `💬 回复` : `🔏 发送者信息已隐藏`,
            ...(withUrl
              ? { url: `tg://user?id=${senderUid}` }
              : { callback_data: senderUid }),
          },
        ],
      ];

      // 如果是纯文本消息，直接发送构造的消息
      if (!fileId) {
        return await postToTelegramApi(botToken, "sendMessage", {
          chat_id: ownerUid,
          text: sourceInfo,
          reply_markup: { inline_keyboard: ik },
        });
      }

      // 如果是媒体消息，则转发并添加说明
      return await postToTelegramApi(botToken, "copyMessage", {
        chat_id: ownerUid,
        from_chat_id: message.chat.id,
        message_id: message.message_id,
        caption: sourceInfo,
        reply_markup: { inline_keyboard: ik },
      });
    };

    const response = await copyMessage(true);
    if (!response.ok) {
      await copyMessage();
    }

    return new Response("OK");
  } catch (error) {
    console.error("Error handling webhook:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

export async function handleRequest(request, config) {
  const { prefix, secretToken } = config;

  const url = new URL(request.url);
  const path = url.pathname;

  const INSTALL_PATTERN = new RegExp(`^/${prefix}/install/([^/]+)/([^/]+)$`);
  const UNINSTALL_PATTERN = new RegExp(`^/${prefix}/uninstall/([^/]+)$`);
  const WEBHOOK_PATTERN = new RegExp(`^/${prefix}/webhook/([^/]+)/([^/]+)$`);

  let match;

  if ((match = path.match(INSTALL_PATTERN))) {
    return handleInstall(request, match[1], match[2], prefix, secretToken);
  }

  if ((match = path.match(UNINSTALL_PATTERN))) {
    return handleUninstall(match[1], secretToken);
  }

  if ((match = path.match(WEBHOOK_PATTERN))) {
    return handleWebhook(request, match[1], match[2], secretToken);
  }

  return new Response("Not Found", { status: 404 });
}
