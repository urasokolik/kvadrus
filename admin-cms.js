// KVADRUS 4X4 - Universal On-Page Visual Editor & CMS
(function () {
  'use strict';

  const AUTH_KEY = 'kvadrus_admin_auth';
  const PASS_HASH = '34523';
  const CACHE_KEY = 'kvadrus_cms_cache';
  const GITHUB_REPO = 'urasokolik/kvadrus';
  const ENC_KEY = '545c5a6d505c7b5d5e00644147517f077a585c47437a707b405c415c560362655b0303697c5a6669';
  const API_ENDPOINT = window.location.origin.includes('netlify')
    ? '/.netlify/functions/save-content'
    : 'https://kvadrus-official.netlify.app/.netlify/functions/save-content';

  function getDecryptedToken(pin) {
    if (!pin) return null;
    let token = '';
    for (let i = 0; i < ENC_KEY.length; i += 2) {
      const byte = parseInt(ENC_KEY.substr(i, 2), 16);
      const k = pin.charCodeAt((i / 2) % pin.length);
      token += String.fromCharCode(byte ^ k);
    }
    return token;
  }

  async function directGitHubRequest(path, method, body, token) {
    const postData = body ? JSON.stringify(body) : null;
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}${path}`, {
      method: method || 'GET',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        ...(postData ? { 'Content-Type': 'application/json' } : {})
      },
      body: postData
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  async function putFileDirect(path, contentBase64, commitMessage, token) {
    let sha;
    try {
      const check = await directGitHubRequest(`/contents/${path}`, 'GET', null, token);
      if (check.ok && check.data && check.data.sha) {
        sha = check.data.sha;
      }
    } catch (e) {}

    const payload = {
      message: commitMessage || `Update ${path} via Kvadrus Admin`,
      content: contentBase64,
      ...(sha ? { sha } : {})
    };

    const res = await directGitHubRequest(`/contents/${path}`, 'PUT', payload, token);
    if (!res.ok) {
      throw new Error(`GitHub (${res.status}): ${res.data?.message || 'Ошибка записи'}`);
    }
    return res.data;
  }

  let cmsState = {
    texts: {},
    images: {},
    newImages: [],
    dirtyCount: 0,
    isPreview: false
  };

  // Inject CSS Styles for Editor UI
  function injectStyles() {
    if (document.getElementById('kvadrus-admin-styles')) return;
    const style = document.createElement('style');
    style.id = 'kvadrus-admin-styles';
    style.textContent = `
      body.admin-mode-active {
        padding-top: 52px !important;
      }
      
      #kvadrus-admin-bar {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: 52px;
        background: #06111C;
        border-bottom: 2px solid #F97316;
        z-index: 1000000;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 16px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.8);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #FFFFFF;
      }

      .admin-bar-left {
        display: flex;
        align-items: center;
        gap: 14px;
      }

      .admin-status-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: #112638;
        padding: 4px 10px;
        border-radius: 4px;
        font-size: 13px;
        font-weight: 700;
        color: #10B981;
        letter-spacing: 0.5px;
      }

      .admin-status-badge .dot {
        width: 8px;
        height: 8px;
        background: #10B981;
        border-radius: 50%;
        box-shadow: 0 0 8px #10B981;
      }

      .admin-dirty-counter {
        font-size: 13px;
        color: #94A3B8;
      }

      .admin-dirty-counter strong {
        color: #F97316;
      }

      .admin-bar-right {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .admin-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: #1E293B;
        color: #FFFFFF;
        border: 1px solid #334155;
        padding: 6px 14px;
        border-radius: 4px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .admin-btn:hover {
        background: #334155;
        border-color: #64748B;
      }

      .admin-btn-publish {
        background: #EA580C;
        border-color: #F97316;
        color: #FFFFFF;
      }

      .admin-btn-publish:hover {
        background: #F97316;
        box-shadow: 0 0 12px rgba(249, 115, 22, 0.4);
      }

      .admin-btn-logout {
        background: transparent;
        border-color: #475569;
        color: #94A3B8;
      }

      .admin-btn-logout:hover {
        background: #DC2626;
        border-color: #EF4444;
        color: #FFFFFF;
      }

      /* Editable Elements Highlight */
      body.admin-mode-active:not(.admin-preview-mode) [data-cms] {
        outline: 1px dashed rgba(249, 115, 22, 0.45);
        outline-offset: 3px;
        cursor: text;
        transition: outline 0.2s, background 0.2s;
      }

      body.admin-mode-active:not(.admin-preview-mode) [data-cms]:hover {
        outline: 2px dashed #F97316;
        background: rgba(249, 115, 22, 0.08);
      }

      body.admin-mode-active:not(.admin-preview-mode) [data-cms]:focus {
        outline: 2px solid #F97316;
        background: rgba(249, 115, 22, 0.12);
      }

      /* Image Overlay Controls */
      .admin-img-wrapper {
        position: relative !important;
      }

      .gallery-card img, .eng-photo-card img {
        width: 100% !important;
        height: 100% !important;
        object-fit: cover !important;
        display: block !important;
      }

      .photo-seal-russia {
        position: absolute !important;
        top: 14px !important;
        right: 14px !important;
        width: auto !important;
        height: auto !important;
        max-width: 160px !important;
        max-height: 48px !important;
        background: #FFFFFF !important;
        padding: 6px 14px !important;
        border-radius: 6px !important;
        z-index: 10 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }

      .photo-seal-russia img {
        width: auto !important;
        height: 28px !important;
        max-width: 130px !important;
        object-fit: contain !important;
        display: block !important;
      }

      .admin-img-toolbar {
        position: absolute;
        top: 8px;
        right: 8px;
        display: flex;
        gap: 6px;
        z-index: 100;
        opacity: 0.95;
        transition: opacity 0.2s ease;
      }

      .admin-img-btn {
        background: rgba(6, 17, 28, 0.92);
        color: #FFFFFF;
        border: 1px solid #F97316;
        padding: 5px 9px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        gap: 4px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.6);
      }

      .admin-img-btn:hover {
        background: #F97316;
        color: #FFFFFF;
      }

      body.admin-preview-mode .admin-img-toolbar {
        display: none !important;
      }

      /* Auth Modal */
      #kvadrus-auth-modal {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(4, 9, 15, 0.88);
        backdrop-filter: blur(8px);
        z-index: 2000000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }

      .auth-modal-box {
        background: #0B1927;
        border: 2px solid #F97316;
        border-radius: 8px;
        width: 100%;
        max-width: 380px;
        padding: 28px 24px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.8);
        text-align: center;
        color: #FFFFFF;
        position: relative;
      }

      .auth-modal-icon {
        font-size: 32px;
        margin-bottom: 8px;
      }

      .auth-modal-title {
        font-size: 18px;
        font-weight: 800;
        letter-spacing: 1px;
        color: #FFFFFF;
        margin-bottom: 6px;
      }

      .auth-modal-desc {
        font-size: 13px;
        color: #94A3B8;
        margin-bottom: 20px;
        line-height: 1.4;
      }

      .auth-modal-input {
        width: 100%;
        padding: 12px;
        font-size: 22px;
        font-weight: 700;
        text-align: center;
        letter-spacing: 6px;
        background: #06111C;
        border: 2px solid #334155;
        border-radius: 6px;
        color: #FFFFFF;
        margin-bottom: 16px;
        box-sizing: border-box;
      }

      .auth-modal-input:focus {
        outline: none;
        border-color: #F97316;
        box-shadow: 0 0 10px rgba(249, 115, 22, 0.4);
      }

      .auth-modal-error {
        color: #EF4444;
        font-size: 12px;
        margin-bottom: 12px;
        display: none;
      }

      .auth-modal-actions {
        display: flex;
        gap: 10px;
      }

      .auth-modal-actions button {
        flex: 1;
        padding: 10px;
        font-size: 14px;
        font-weight: 700;
        border-radius: 6px;
        cursor: pointer;
        border: none;
      }

      .auth-btn-submit {
        background: #EA580C;
        color: #FFFFFF;
      }
      .auth-btn-submit:hover { background: #F97316; }

      .auth-btn-cancel {
        background: #1E293B;
        color: #94A3B8;
      }
      .auth-btn-cancel:hover { background: #334155; color: #FFF; }

      /* Toast Notification */
      #kvadrus-toast {
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: #06111C;
        border: 2px solid #10B981;
        color: #FFFFFF;
        padding: 14px 20px;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 600;
        z-index: 3000000;
        box-shadow: 0 6px 24px rgba(0,0,0,0.8);
        display: flex;
        align-items: center;
        gap: 10px;
        animation: toast-in 0.3s ease;
      }

      @keyframes toast-in {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  // Toast message
  function showToast(text, isError = false) {
    const existing = document.getElementById('kvadrus-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'kvadrus-toast';
    toast.style.borderColor = isError ? '#EF4444' : '#10B981';
    toast.innerHTML = `${isError ? '⚠️' : '✅'} <span>${text}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.transition = 'opacity 0.4s';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 400);
    }, 4500);
  }

  // Auth Dialog
  function showAuthModal() {
    if (document.getElementById('kvadrus-auth-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'kvadrus-auth-modal';
    modal.innerHTML = `
      <div class="auth-modal-box">
        <div class="auth-modal-icon">⚙️</div>
        <div class="auth-modal-title">ВХОД В РЕДАКТОР</div>
        <div class="auth-modal-desc">Введите PIN-код для редактирования любых текстов и фото</div>
        <input type="password" inputmode="numeric" class="auth-modal-input" id="admin-pin-input" maxlength="10" placeholder="•••••" autofocus />
        <div class="auth-modal-error" id="auth-modal-error">Неверный PIN-код</div>
        <div class="auth-modal-actions">
          <button type="button" class="auth-btn-cancel" id="admin-auth-cancel">Отмена</button>
          <button type="button" class="auth-btn-submit" id="admin-auth-submit">Войти</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const input = document.getElementById('admin-pin-input');
    const err = document.getElementById('auth-modal-error');
    const submitBtn = document.getElementById('admin-auth-submit');
    const cancelBtn = document.getElementById('admin-auth-cancel');

    function checkAuth() {
      const val = input.value.trim();
      if (val === PASS_HASH) {
        sessionStorage.setItem(AUTH_KEY, val);
        modal.remove();
        activateAdminMode();
        showToast('Режим редактора включен! Кликайте по ЛЮБОМУ тексту или фото.');
      } else {
        err.style.display = 'block';
        input.value = '';
        input.focus();
      }
    }

    submitBtn.addEventListener('click', checkAuth);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') checkAuth();
      if (e.key === 'Escape') modal.remove();
    });
    cancelBtn.addEventListener('click', () => modal.remove());
    setTimeout(() => input.focus(), 100);
  }

  // Top Floating Bar
  function renderAdminBar() {
    if (document.getElementById('kvadrus-admin-bar')) return;

    const bar = document.createElement('div');
    bar.id = 'kvadrus-admin-bar';
    bar.innerHTML = `
      <div class="admin-bar-left">
        <div class="admin-status-badge">
          <span class="dot"></span>
          <span>РЕЖИМ РЕДАКТОРА</span>
        </div>
        <div class="admin-dirty-counter">
          Правки: <strong id="admin-dirty-num">${cmsState.dirtyCount}</strong>
        </div>
      </div>
      <div class="admin-bar-right">
        <button type="button" class="admin-btn" id="admin-btn-preview" title="Посмотреть страницу без рамок">👁️ Предпросмотр</button>
        <button type="button" class="admin-btn admin-btn-publish" id="admin-btn-publish">💾 Опубликовать на сайте</button>
        <button type="button" class="admin-btn" id="admin-btn-backup" title="Скачать резервную копию всех правок на устройство">📥 Копия</button>
        <button type="button" class="admin-btn admin-btn-logout" id="admin-btn-logout">🚪 Выйти</button>
      </div>
    `;
    document.body.appendChild(bar);

    document.getElementById('admin-btn-preview').addEventListener('click', togglePreview);
    document.getElementById('admin-btn-publish').addEventListener('click', publishChanges);
    document.getElementById('admin-btn-backup').addEventListener('click', downloadBackup);
    document.getElementById('admin-btn-logout').addEventListener('click', logout);
  }

  function downloadBackup() {
    document.querySelectorAll('[data-cms]').forEach(el => {
      const key = el.getAttribute('data-cms');
      cmsState.texts[key] = el.innerHTML;
    });
    const content = {
      texts: cmsState.texts,
      images: cmsState.images,
      updatedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kvadrus-content-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Резервная копия сохранена на устройство!');
  }

  function updateDirtyCount() {
    const el = document.getElementById('admin-dirty-num');
    if (el) el.textContent = cmsState.dirtyCount;
  }

  function togglePreview() {
    cmsState.isPreview = !cmsState.isPreview;
    const btn = document.getElementById('admin-btn-preview');
    if (cmsState.isPreview) {
      document.body.classList.add('admin-preview-mode');
      btn.innerHTML = '✏️ Редактировать';
      btn.style.borderColor = '#F97316';
    } else {
      document.body.classList.remove('admin-preview-mode');
      btn.innerHTML = '👁️ Предпросмотр';
      btn.style.borderColor = '#334155';
    }
  }

  function logout() {
    sessionStorage.removeItem(AUTH_KEY);
    document.body.classList.remove('admin-mode-active', 'admin-preview-mode');
    const bar = document.getElementById('kvadrus-admin-bar');
    if (bar) bar.remove();
    document.querySelectorAll('[data-cms]').forEach(el => el.removeAttribute('contenteditable'));
    document.querySelectorAll('.admin-img-toolbar').forEach(el => el.remove());
    showToast('Вы вышли из режима редактора.');
  }

  // Generate deterministic ID for any text element
  function getDeterministicKey(el, idx) {
    if (el.getAttribute('data-cms')) return el.getAttribute('data-cms');
    
    // Check closest section/card
    const section = el.closest('section')?.id || el.closest('header, footer, nav')?.tagName.toLowerCase() || 'sec';
    const tag = el.tagName.toLowerCase();
    const classSnippet = (el.className && typeof el.className === 'string') 
      ? el.className.split(' ').filter(c => !c.startsWith('admin-')).slice(0, 1).join('_') 
      : '';
    const key = `cms_${section}_${tag}${classSnippet ? '_' + classSnippet : ''}_${idx}`;
    el.setAttribute('data-cms', key);
    return key;
  }

  // Setup Universal Text Editing across ALL text-bearing elements
  function setupEditableTexts() {
    // Select all potential text elements
    const selectors = [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 
      'p', '.eyebrow', '.highlight', 
      '.spec-box-val', '.spec-box-lbl', 
      '.hero-media-badge', '.cap', '.gallery-caption', 
      '.footer-nav li', '.btn', '.badge', 
      '.eng-item h4', '.eng-item p', '.eng-tag',
      '.calc-card', '.credit-card', '.hero-lead-text',
      '.brand-name', '.brand-tagline',
      '.links-bar-text strong', '.links-bar-text span',
      '[data-cms]'
    ];

    const elements = document.querySelectorAll(selectors.join(', '));
    let idx = 0;

    elements.forEach(el => {
      // Ignore admin elements, scripts, inputs
      if (el.closest('#kvadrus-admin-bar') || el.closest('#kvadrus-auth-modal') || el.closest('.admin-img-toolbar')) return;
      if (['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA', 'SELECT', 'VIDEO'].includes(el.tagName)) return;
      
      // Only make leaf-ish elements editable (elements whose children are mostly text/inline)
      const hasBlockChildren = Array.from(el.children).some(child => 
        ['DIV', 'SECTION', 'UL', 'OL', 'TABLE', 'FORM'].includes(child.tagName)
      );
      if (hasBlockChildren && !el.hasAttribute('data-cms')) return;

      const key = getDeterministicKey(el, idx++);
      el.setAttribute('contenteditable', 'true');
      el.setAttribute('spellcheck', 'false');

      // Prevent link navigation during editing
      if (el.tagName === 'A' || el.closest('a')) {
        el.addEventListener('click', (e) => {
          if (document.body.classList.contains('admin-mode-active') && !cmsState.isPreview) {
            e.preventDefault();
          }
        });
      }

      el.addEventListener('input', () => {
        cmsState.texts[key] = el.innerHTML;
        cmsState.dirtyCount++;
        updateDirtyCount();
      });
    });
  }

  // Physical Canvas-based Image Rotation (Flips real pixels so image fits container 100% naturally without overflow)
  function rotateImageViaCanvas(imgElement, degrees, callback) {
    const image = new Image();
    image.onload = () => {
      try {
        let origW = image.width;
        let origH = image.height;
        const maxD = 1200;
        if (origW > maxD || origH > maxD) {
          if (origW > origH) {
            origH = Math.round((origH * maxD) / origW);
            origW = maxD;
          } else {
            origW = Math.round((origW * maxD) / origH);
            origH = maxD;
          }
        }

        const canvas = document.createElement('canvas');
        if (degrees === 90 || degrees === 270) {
          canvas.width = origH;
          canvas.height = origW;
        } else {
          canvas.width = origW;
          canvas.height = origH;
        }
        const ctx = canvas.getContext('2d');
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((degrees * Math.PI) / 180);
        ctx.drawImage(image, -origW / 2, -origH / 2, origW, origH);
        const dataUrl = canvas.toDataURL('image/webp', 0.82);
        callback(dataUrl);
      } catch (err) {
        console.error('Canvas rotate error:', err);
        // Fallback to CSS transform if canvas fails
        imgElement.style.transform = 'rotate(' + degrees + 'deg)';
      }
    };
    image.onerror = (e) => {
      console.error('Image load error for canvas rotate:', e);
    };
    image.src = imgElement.src;
  }

  // Setup Image Controls (Rotate via Canvas, Replace)
  function setupImageControls() {
    const images = document.querySelectorAll('.gallery-card img, .eng-photo-card img');
    images.forEach((img, idx) => {
      const parent = img.parentElement;
      if (!parent.classList.contains('admin-img-wrapper')) {
        parent.classList.add('admin-img-wrapper');
      }

      if (parent.querySelector('.admin-img-toolbar')) return;

      const imgKey = img.getAttribute('data-img-key') || `img_${idx}`;
      img.setAttribute('data-img-key', imgKey);

      const toolbar = document.createElement('div');
      toolbar.className = 'admin-img-toolbar';
      toolbar.innerHTML = `
        <button type="button" class="admin-img-btn" data-act="rotate" title="Повернуть фото на 90 градусов">↺ 90°</button>
        <button type="button" class="admin-img-btn" data-act="replace" title="Загрузить другое фото">📁 Заменить</button>
        <input type="file" accept="image/*" style="display:none" class="admin-file-input">
      `;
      parent.appendChild(toolbar);

      const rotateBtn = toolbar.querySelector('[data-act="rotate"]');
      const replaceBtn = toolbar.querySelector('[data-act="replace"]');
      const fileInput = toolbar.querySelector('.admin-file-input');

      // Physical rotate handler: swaps width/height on canvas so it perfectly stretches inside parent container
      rotateBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        rotateBtn.innerHTML = '⏳';
        rotateBtn.disabled = true;

        rotateImageViaCanvas(img, 90, (rotatedDataUrl) => {
          img.src = rotatedDataUrl;
          img.style.transform = 'none'; // No CSS transform needed, real pixel data is rotated!

          const newFileName = `img_web/rot_${Date.now()}_${imgKey}.webp`;
          if (!cmsState.images[imgKey]) cmsState.images[imgKey] = {};
          cmsState.images[imgKey].src = newFileName;

          // Track for backend upload
          cmsState.newImages = cmsState.newImages.filter(item => item.path !== newFileName);
          cmsState.newImages.push({
            path: newFileName,
            base64: rotatedDataUrl
          });

          cmsState.dirtyCount++;
          updateDirtyCount();
          rotateBtn.innerHTML = '↺ 90°';
          rotateBtn.disabled = false;
          showToast('Фото повернуто и адаптировано под карточку!');
        });
      });

      // Replace photo handler
      replaceBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fileInput.click();
      });

      fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (re) => {
          compressImageToWebP(re.target.result, 1200, 0.82, (compressedDataUrl) => {
            img.src = compressedDataUrl;
            img.style.transform = 'none';

            const newFileName = `img_web/user_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '')}`;
            if (!cmsState.images[imgKey]) cmsState.images[imgKey] = {};
            cmsState.images[imgKey].src = newFileName;

            cmsState.newImages.push({
              path: newFileName,
              base64: compressedDataUrl
            });

            cmsState.dirtyCount++;
            updateDirtyCount();
            showToast('Фото заменено! Нажмите «Опубликовать», чтобы сохранить.');
          });
        };
        reader.readAsDataURL(file);
      });
    });

    // Brand Logo Support
    const logoImg = document.querySelector('.brand-logo-img');
    if (logoImg && !logoImg.parentElement.querySelector('.admin-logo-toolbar')) {
      const parent = logoImg.parentElement;
      const logoToolbar = document.createElement('div');
      logoToolbar.className = 'admin-img-toolbar admin-logo-toolbar';
      logoToolbar.style.top = '-6px';
      logoToolbar.style.right = '-6px';
      logoToolbar.innerHTML = `
        <button type="button" class="admin-img-btn" data-act="replace-logo" title="Загрузить новый логотип">📁</button>
        <input type="file" accept="image/*" style="display:none" class="admin-logo-file-input">
      `;
      parent.appendChild(logoToolbar);

      const replaceBtn = logoToolbar.querySelector('[data-act="replace-logo"]');
      const fileInput = logoToolbar.querySelector('.admin-logo-file-input');

      replaceBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fileInput.click();
      });

      fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (re) => {
          compressImageToWebP(re.target.result, 600, 0.9, (compressedDataUrl) => {
            logoImg.src = compressedDataUrl;
            const newFileName = `img_web/user_logo_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '')}`;
            
            if (!cmsState.images['brand_logo']) cmsState.images['brand_logo'] = {};
            cmsState.images['brand_logo'].src = newFileName;

            cmsState.newImages.push({
              path: newFileName,
              base64: compressedDataUrl
            });

            cmsState.dirtyCount++;
            updateDirtyCount();
            showToast('Логотип заменен! Нажмите «Опубликовать», чтобы сохранить.');
          });
        };
        reader.readAsDataURL(file);
      });
    }
  }

  // Compress image on canvas
  function compressImageToWebP(src, maxDim, quality, cb) {
    const im = new Image();
    im.onload = () => {
      let w = im.width;
      let h = im.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(im, 0, 0, w, h);
      cb(canvas.toDataURL('image/webp', quality));
    };
    im.src = src;
  }

  // Publish changes: Direct to GitHub API (primary) with Netlify function fallback
  async function publishChanges() {
    const btn = document.getElementById('admin-btn-publish');
    const oldText = btn.innerHTML;
    btn.innerHTML = '⏳ Сохранение...';
    btn.disabled = true;

    try {
      // Gather latest texts from all [data-cms]
      document.querySelectorAll('[data-cms]').forEach(el => {
        const key = el.getAttribute('data-cms');
        cmsState.texts[key] = el.innerHTML;
      });

      const contentToSave = {
        texts: cmsState.texts,
        images: cmsState.images,
        updatedAt: new Date().toISOString()
      };

      // 1. Immediately cache in localStorage so no refresh loses anything
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(contentToSave));
      } catch (e) {}

      // Try Direct GitHub API first (100% works in Russia without VPN, no Netlify limits)
      const pin = sessionStorage.getItem(AUTH_KEY) || PASS_HASH;
      const token = getDecryptedToken(pin);
      let success = false;
      let lastErr = null;

      if (token && token.startsWith('gho_')) {
        try {
          // Upload new images if any
          if (Array.isArray(cmsState.newImages) && cmsState.newImages.length > 0) {
            for (let i = 0; i < cmsState.newImages.length; i++) {
              const imgItem = cmsState.newImages[i];
              btn.innerHTML = `⏳ Фото (${i+1}/${cmsState.newImages.length})...`;
              const cleanBase64 = imgItem.base64.replace(/^data:image\/\w+;base64,/, '');
              await putFileDirect(imgItem.path, cleanBase64, `Upload ${imgItem.path} via Admin`, token);
            }
          }

          // Upload content.json
          btn.innerHTML = '⏳ Сохранение текста...';
          const jsonStr = JSON.stringify(contentToSave, null, 2);
          const utf8Bytes = new TextEncoder().encode(jsonStr);
          let binary = '';
          const len = utf8Bytes.byteLength;
          for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(utf8Bytes[i]);
          }
          const base64Content = btoa(binary);

          await putFileDirect('content.json', base64Content, 'Обновление контента через редактор сайта', token);
          success = true;
        } catch (directErr) {
          console.warn('Direct GitHub save failed, trying fallback...', directErr);
          lastErr = directErr;
        }
      }

      // Fallback to Netlify function if direct save failed or no token
      if (!success) {
        btn.innerHTML = '⏳ Резервный канал...';
        const payload = {
          password: PASS_HASH,
          content: contentToSave,
          newImages: cmsState.newImages
        };

        const res = await fetch(API_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) {
          throw new Error(data.error || lastErr?.message || 'Ошибка сети при сохранении');
        }
        success = true;
      }

      cmsState.dirtyCount = 0;
      cmsState.newImages = [];
      updateDirtyCount();
      showToast('Опубликовано! Сайт сохранен и обновлен без задержек.');
    } catch (err) {
      console.error('Save failed:', err);
      showToast('⚠️ Ошибка сети. Ваши правки сохранены в браузере! Нажмите «Опубликовать» еще раз.', true);
    } finally {
      btn.innerHTML = oldText;
      btn.disabled = false;
    }
  }

  // Activate Admin Mode
  function activateAdminMode() {
    document.body.classList.add('admin-mode-active');
    const badge = document.getElementById('kvadrus-cms-floating-badge');
    if (badge) badge.style.display = 'none';
    injectStyles();
    renderAdminBar();
    setupEditableTexts();
    setupImageControls();
  }

  // Global trigger setup
  function initTrigger() {
    injectStyles();

    // Floating CMS button in bottom-left
    if (!document.getElementById('kvadrus-cms-floating-badge')) {
      const floatBtn = document.createElement('button');
      floatBtn.id = 'kvadrus-cms-floating-badge';
      floatBtn.innerHTML = '⚙️ CMS';
      floatBtn.title = 'Редактировать сайт';
      floatBtn.style.cssText = 'position:fixed;bottom:18px;left:18px;z-index:999999;background:rgba(17,20,25,0.88);border:1px solid rgba(242,169,0,0.6);color:#F2A900;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:700;font-family:monospace;cursor:pointer;backdrop-filter:blur(6px);box-shadow:0 4px 14px rgba(0,0,0,0.6);transition:all 0.2s;';
      floatBtn.onmouseover = () => { floatBtn.style.background = '#F2A900'; floatBtn.style.color = '#111419'; };
      floatBtn.onmouseout = () => { floatBtn.style.background = 'rgba(17,20,25,0.88)'; floatBtn.style.color = '#F2A900'; };
      floatBtn.onclick = () => showAuthModal();
      document.body.appendChild(floatBtn);
    }

    // Check if already authenticated this session
    if (sessionStorage.getItem(AUTH_KEY) === PASS_HASH) {
      activateAdminMode();
    }

    // Check URL parameter: ?admin=1 or #admin
    if (window.location.search.includes('admin') || window.location.hash.includes('admin')) {
      showAuthModal();
    }

    // Triple click on "Кузов: 1250 × 1800 мм"
    const triggerEl = document.getElementById('admin-trigger-cub') || 
      Array.from(document.querySelectorAll('li')).find(li => li.textContent.includes('Кузов: 1250'));

    if (triggerEl) {
      triggerEl.setAttribute('id', 'admin-trigger-cub');
      triggerEl.style.cursor = 'pointer';

      let clickCount = 0;
      let clickTimer = null;

      triggerEl.addEventListener('click', (e) => {
        clickCount++;
        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => { clickCount = 0; }, 1200);

        if (clickCount >= 3) {
          clickCount = 0;
          clearTimeout(clickTimer);
          showAuthModal();
        }
      });
    }
  }

  // Expose API
  window.KvadrusAdmin = {
    open: showAuthModal,
    logout: logout
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTrigger);
  } else {
    initTrigger();
  }
})();
