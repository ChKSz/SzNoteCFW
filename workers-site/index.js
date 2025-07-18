import { getAssetFromKV } from '@cloudflare/kv-asset-handler'
import { Router } from 'itty-router'

// 创建路由器
const router = Router()

// 加密算法常量
const ALGORITHM = 'AES-GCM';
const IV_LENGTH = 12;
const SALT_LENGTH = 16;

// 从密码派生密钥 (使用Web Crypto API)
async function deriveKey(password, salt) {
  const encoder = new TextEncoder();
  const passwordData = encoder.encode(password);
  const saltBuffer = salt instanceof ArrayBuffer ? salt : salt.buffer;
  
  // 导入密码作为原始密钥材料
  const baseKey = await crypto.subtle.importKey(
    'raw',
    passwordData,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  
  // 使用PBKDF2派生AES-GCM密钥
  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: 100000,
      hash: 'SHA-256'
    },
    baseKey,
    { name: ALGORITHM, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// 加密内容
async function encryptContent(plainText, password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plainText);
  
  // 生成随机盐和IV
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  
  // 派生密钥
  const key = await deriveKey(password, salt);
  
  // 加密数据
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    data
  );
  
  // 转换为Base64
  const encryptedArray = new Uint8Array(encryptedBuffer);
  const encryptedBase64 = btoa(String.fromCharCode.apply(null, encryptedArray));
  const saltBase64 = btoa(String.fromCharCode.apply(null, salt));
  const ivBase64 = btoa(String.fromCharCode.apply(null, iv));
  
  return {
    encrypted: true,
    salt: saltBase64,
    iv: ivBase64,
    data: encryptedBase64
  };
}

// 解密内容
async function decryptContent(encryptedObj, password) {
  // 转换Base64为ArrayBuffer
  const encryptedData = Uint8Array.from(atob(encryptedObj.data), c => c.charCodeAt(0));
  const salt = Uint8Array.from(atob(encryptedObj.salt), c => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(encryptedObj.iv), c => c.charCodeAt(0));
  
  // 派生密钥
  const key = await deriveKey(password, salt);
  
  // 解密数据
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    encryptedData
  );
  
  // 转换为字符串
  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}

// 密码哈希函数 (使用Web Crypto API)
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  
  // 生成随机盐
  const salt = crypto.getRandomValues(new Uint8Array(16));
  
  // 导入密码作为原始密钥材料
  const baseKey = await crypto.subtle.importKey(
    'raw',
    data,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  
  // 使用PBKDF2派生哈希
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    baseKey,
    256
  );
  
  // 转换为Base64
  const hashArray = new Uint8Array(derivedBits);
  const hashBase64 = btoa(String.fromCharCode.apply(null, hashArray));
  const saltBase64 = btoa(String.fromCharCode.apply(null, salt));
  
  return `pbkdf2:sha256:100000:${saltBase64}:${hashBase64}`;
}

// 验证密码
async function verifyPassword(password, hash) {
  try {
    const [algorithm, hashType, iterations, saltBase64, hashBase64] = hash.split(':');
    
    if (algorithm !== 'pbkdf2' || hashType !== 'sha256') {
      return false;
    }
    
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const salt = Uint8Array.from(atob(saltBase64), c => c.charCodeAt(0));
    const storedHash = Uint8Array.from(atob(hashBase64), c => c.charCodeAt(0));
    
    // 导入密码作为原始密钥材料
    const baseKey = await crypto.subtle.importKey(
      'raw',
      data,
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    
    // 使用相同参数派生哈希
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: parseInt(iterations, 10),
        hash: 'SHA-256'
      },
      baseKey,
      256
    );
    
    // 比较哈希
    const newHash = new Uint8Array(derivedBits);
    
    if (newHash.length !== storedHash.length) {
      return false;
    }
    
    // 时间恒定比较
    let diff = 0;
    for (let i = 0; i < newHash.length; i++) {
      diff |= newHash[i] ^ storedHash[i];
    }
    
    return diff === 0;
  } catch (error) {
    console.error('Password verification error:', error);
    return false;
  }
}

// 安全清理和验证笔记ID
function sanitizeNoteId(noteId) {
  if (!noteId || typeof noteId !== 'string') return null;
  const cleaned = noteId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (cleaned.length === 0 || cleaned.length > 50) return null;
  return cleaned;
}

// 处理静态资源
async function handleStaticAsset(request, event) {
  try {
    // 尝试从KV中获取静态资源
    return await getAssetFromKV(event);
  } catch (e) {
    // 如果找不到资源 (例如 /some-note-id)，
    // 则返回 index.html，让客户端路由处理
    try {
      const url = new URL(request.url);
      url.pathname = '/index.html'; // 将路径重写为 index.html
      const newRequest = new Request(url.toString(), request);
      const newEvent = { ...event, request: newRequest };
      return await getAssetFromKV(newEvent);
    } catch (e) {
      // 如果连 index.html 都找不到，则返回 404
      return new Response('Not Found', { status: 404 });
    }
  }
}

// API 路由：获取笔记
router.get('/api/note/:id', async ({ params }, event) => {
  const noteId = sanitizeNoteId(params.id);
  if (!noteId) {
    return new Response(JSON.stringify({ message: 'Invalid note ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 从 KV 存储中获取笔记
  const noteData = await SZNOTE_NOTES.get(noteId, 'json');
  if (!noteData) {
    return new Response(JSON.stringify({ content: "", protected: false }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 更新最后访问时间
  noteData.lastAccessedAt = Date.now();
  // 如果是旧笔记没有这些字段，添加默认值
  if (!noteData.createdAt) noteData.createdAt = Date.now();
  if (!noteData.expireDays) noteData.expireDays = 3;
  await SZNOTE_NOTES.put(noteId, JSON.stringify(noteData));

  // 检查笔记是否受密码保护
  if (noteData.passwordHash) {
    const request = event.request;
    const providedPassword = request.headers.get('x-note-password');

    if (!providedPassword) {
      return new Response(JSON.stringify({ protected: true, message: '请输入密码！' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 验证密码
    const passwordValid = await verifyPassword(providedPassword, noteData.passwordHash);
    
    if (passwordValid) {
      // 判断内容是否加密
      if (noteData.content && noteData.content.encrypted) {
        try {
          const decrypted = await decryptContent(noteData.content, providedPassword);
          return new Response(JSON.stringify({ content: decrypted, protected: false }), {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (e) {
          return new Response(JSON.stringify({ protected: true, message: '内容解密失败！' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      } else {
        return new Response(JSON.stringify({ content: noteData.content, protected: false }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } else {
      return new Response(JSON.stringify({ protected: true, message: '密码错误！' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } else {
    // 笔记未受保护
    return new Response(JSON.stringify({ content: noteData.content, protected: false }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// API 路由：保存笔记
router.post('/api/note/:id', async ({ params }, event) => {
  const noteId = sanitizeNoteId(params.id);
  if (!noteId) {
    return new Response(JSON.stringify({ message: '笔记ID格式无效！' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const request = event.request;
  const contentType = request.headers.get('content-type') || '';
  
  let newContent;
  if (contentType.includes('application/json')) {
    const body = await request.json();
    newContent = body.content;
  } else {
    newContent = await request.text();
  }
  
  if (!newContent || newContent.length > 100000) {
    return new Response(JSON.stringify({ message: '笔记内容太大！最大大小为100KB。' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 从 KV 存储中获取笔记
  let noteData = await SZNOTE_NOTES.get(noteId, 'json');

  if (noteData) {
    // 笔记已存在，更新内容，保持原有密码哈希
    if (noteData.passwordHash) {
      // 受保护，需加密内容
      const providedPassword = request.headers.get('x-note-password');
      if (!providedPassword) {
        return new Response(JSON.stringify({ message: '需要密码才能保存受保护的笔记！' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // 验证密码
      const passwordValid = await verifyPassword(providedPassword, noteData.passwordHash);
      if (!passwordValid) {
        return new Response(JSON.stringify({ message: '密码错误，无法保存！' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      noteData.content = await encryptContent(newContent, providedPassword);
    } else {
      // 未受保护，明文存储
      noteData.content = newContent;
    }
    // 更新最后访问时间
    noteData.lastAccessedAt = Date.now();
    // 确保旧笔记有这些字段
    if (!noteData.createdAt) noteData.createdAt = Date.now();
    if (!noteData.expireDays) noteData.expireDays = 3;
  } else {
    // 笔记不存在，创建新笔记 (无密码，默认3天过期)
    const now = Date.now();
    const defaultExpireDays = 3;
    noteData = { 
      content: newContent, 
      passwordHash: null,
      createdAt: now,
      lastAccessedAt: now,
      expireDays: defaultExpireDays
    };
  }

  try {
    await SZNOTE_NOTES.put(noteId, JSON.stringify(noteData));
    return new Response('Note saved', { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ message: '保存笔记失败，服务器错误！' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// API 路由：设置/修改/移除密码
router.post('/api/password/:id', async ({ params }, event) => {
  const noteId = sanitizeNoteId(params.id);
  if (!noteId) {
    return new Response(JSON.stringify({ message: '笔记ID格式无效！' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const request = event.request;
  const body = await request.json();
  const { action, password, newPassword } = body;

  // 验证action
  if (!['set', 'remove'].includes(action)) {
    return new Response(JSON.stringify({ message: '操作无效！' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 验证密码
  if (action === 'set' && (typeof newPassword !== 'string' || newPassword.length < 4)) {
    return new Response(JSON.stringify({ message: '新密码必须是一个至少4个字符的字符串！' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (action === 'remove' && (typeof password !== 'string' || password.length === 0)) {
    return new Response(JSON.stringify({ message: '当前密码是移除保护所必需的！' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 从 KV 存储中获取笔记
  let noteData = await SZNOTE_NOTES.get(noteId, 'json');

  if (!noteData) {
    // 如果笔记不存在，创建一个空笔记
    noteData = { content: "", passwordHash: null };
  }

  try {
    if (action === 'set') {
      // 设置或修改密码
      if (noteData.passwordHash) {
        // 如果笔记已有密码，需要验证旧密码
        if (!password || !(await verifyPassword(password, noteData.passwordHash))) {
          return new Response(JSON.stringify({ message: '密码错误！' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        // 先用旧密码解密内容
        if (noteData.content && noteData.content.encrypted) {
          noteData.content = await decryptContent(noteData.content, password);
        }
      }
      // 用新密码加密内容
      noteData.content = await encryptContent(noteData.content, newPassword);
      noteData.passwordHash = await hashPassword(newPassword);
      await SZNOTE_NOTES.put(noteId, JSON.stringify(noteData));
      return new Response(JSON.stringify({ message: '密码设置成功！' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } else if (action === 'remove') {
      // 移除密码
      if (!noteData.passwordHash) {
        return new Response(JSON.stringify({ message: '该笔记未设置密码！' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (!password || !(await verifyPassword(password, noteData.passwordHash))) {
        return new Response(JSON.stringify({ message: '密码错误！' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      // 解密内容后明文存储
      if (noteData.content && noteData.content.encrypted) {
        noteData.content = await decryptContent(noteData.content, password);
      }
      noteData.passwordHash = null; // 移除密码哈希
      await SZNOTE_NOTES.put(noteId, JSON.stringify(noteData));
      return new Response(JSON.stringify({ message: '密码移除成功！' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ message: '服务器错误，请稍后再试！' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// API 路由：设置笔记过期时间
router.post('/api/expire/:id', async ({ params }, event) => {
  const noteId = sanitizeNoteId(params.id);
  if (!noteId) {
    return new Response(JSON.stringify({ message: '笔记ID格式无效！' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const request = event.request;
  const body = await request.json();
  const { expireDays } = body;

  // 验证过期天数
  if (![3, 7, 30, 365].includes(expireDays)) {
    return new Response(JSON.stringify({ message: '过期天数必须是3、7、30或365天之一！' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 从 KV 存储中获取笔记
  let noteData = await SZNOTE_NOTES.get(noteId, 'json');

  if (!noteData) {
    return new Response(JSON.stringify({ message: '笔记不存在！' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 检查笔记是否受密码保护
  if (noteData.passwordHash) {
    const providedPassword = request.headers.get('x-note-password');
    if (!providedPassword) {
      return new Response(JSON.stringify({ message: '需要密码才能修改受保护笔记的设置！' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    const passwordValid = await verifyPassword(providedPassword, noteData.passwordHash);
    if (!passwordValid) {
      return new Response(JSON.stringify({ message: '密码错误！' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  try {
    noteData.expireDays = expireDays;
    await SZNOTE_NOTES.put(noteId, JSON.stringify(noteData));
    return new Response(JSON.stringify({ message: `笔记过期时间已设置为${expireDays}天！` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ message: '设置过期时间失败，服务器错误！' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// 处理所有请求
async function handleRequest(request, event) {
  const url = new URL(request.url);
  
  // 处理 API 请求
  if (url.pathname.startsWith('/api/')) {
    return router.handle(request, event);
  }
  
  // 处理静态资源
  return handleStaticAsset(request, event);
}

// 主事件监听器
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request, event));
});

// 定期清理过期笔记
async function cleanupExpiredNotes() {
  // 获取所有笔记的列表
  const keys = await SZNOTE_NOTES.list();
  const now = Date.now();
  
  for (const key of keys.keys) {
    const noteId = key.name;
    const noteData = await SZNOTE_NOTES.get(noteId, 'json');
    
    if (noteData && noteData.lastAccessedAt && noteData.expireDays) {
      const expireMs = noteData.expireDays * 24 * 60 * 60 * 1000;
      if (now - noteData.lastAccessedAt > expireMs) {
        await SZNOTE_NOTES.delete(noteId);
        console.log(`自动删除过期笔记: ${noteId} (${noteData.expireDays}天未访问)`);
      }
    }
  }
}

// 处理所有其他 GET 请求（静态文件）
router.get('*', handleStaticAsset);

// 添加 scheduled 事件监听器
addEventListener('scheduled', event => {
  event.waitUntil(cleanupExpiredNotes());
});