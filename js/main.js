(function () {
  'use strict';

  // ----- Джерело трафіку: зберігаємо UTM-мітки та gclid з першого заходу -----
  var TRACK_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid', 'fbclid',
    'lead_token', 'nisha'];
  var params = new URLSearchParams(location.search);
  var tracking = {};
  try { tracking = JSON.parse(sessionStorage.getItem('lead_tracking') || '{}'); } catch (e) {}
  TRACK_KEYS.forEach(function (k) { if (params.get(k)) tracking[k] = params.get(k); });
  try { sessionStorage.setItem('lead_tracking', JSON.stringify(tracking)); } catch (e) {}

  // Куди переходити після успішної заявки
  var THANK_YOU_URL = '/thank-you';

  // ----- Назви форм (потрапляють у заявку, щоб менеджер бачив, звідки вона) -----
  var FORMS = {
    consultation: {
      name: 'Заявка на безкоштовну консультацію (СКЗ — Google пошук)',
      button: 'Получить бесплатную консультацию'
    },
    discount: {
      name: 'Бронювання зі знижкою 50% (СКЗ — Google пошук)',
      button: 'Забронировать со скидкой 50%'
    },
    hero: {
      name: 'Заявка на безкоштовну консультацію, форма на першому екрані (СКЗ — Google пошук)',
      button: 'Получить бесплатную консультацию'
    }
  };

  // ----- Форми заявки (модальна + відкрита на першому екрані) -----
  function validPhone(v) { return v.replace(/\D/g, '').length >= 10; }

  function showForm(box) {
    box.querySelector('.lead-form').hidden = false;
    box.querySelector('.lead-thanks').hidden = true;
    box.querySelector('.lead-form__error').hidden = true;
  }

  function initForm(form) {
    var box = form.closest('.lead-box');
    var thanks = box.querySelector('.lead-thanks');
    var errorBox = form.querySelector('.lead-form__error');
    var submitBtn = form.querySelector('[type="submit"]');
    var nameInput = form.elements.name;
    var phoneInput = form.elements.phone;

    form.elements.form.value = (FORMS[form.getAttribute('data-form-kind')] || FORMS.consultation).name;

    // Телефон: лишаємо тільки цифри та «+»
    phoneInput.addEventListener('focus', function () { if (!phoneInput.value) phoneInput.value = '+380'; });
    phoneInput.addEventListener('input', function () {
      var v = phoneInput.value.replace(/[^\d+]/g, '');
      phoneInput.value = v.charAt(0) === '+' ? '+' + v.slice(1).replace(/\+/g, '') : v.replace(/\+/g, '');
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = nameInput.value.trim();
      var phone = phoneInput.value.trim();

      nameInput.setAttribute('aria-invalid', String(!name));
      phoneInput.setAttribute('aria-invalid', String(!validPhone(phone)));
      if (!name || !validPhone(phone)) {
        errorBox.textContent = 'Пожалуйста, укажите имя и корректный номер телефона.';
        errorBox.hidden = false;
        return;
      }

      errorBox.hidden = true;
      submitBtn.disabled = true;

      var payload = {
        name: name,
        phone: phone,
        form: form.elements.form.value,
        source: form.elements.source.value,     // статичні поля для NetHunt
        leadname: form.elements.leadname.value,
        website: form.elements.website.value, // honeypot
        page: location.href,
        referrer: document.referrer,
        tracking: tracking
      };

      fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function () {
          form.reset();
          form.hidden = true;
          thanks.hidden = false;

          // Позначка для сторінки подяки: конверсія Google Ads рахується лише після реальної заявки
          try { sessionStorage.setItem('lead_submitted', '1'); } catch (e) {}
          if (typeof window.fbq === 'function') window.fbq('track', 'Lead');

          // Подія для GTM, потім перехід на сторінку подяки (не чекаємо GTM довше 1 с)
          var redirected = false;
          function goThanks() { if (!redirected) { redirected = true; location.href = THANK_YOU_URL; } }
          window.dataLayer = window.dataLayer || [];
          window.dataLayer.push({ event: 'lead_form_submit', form_name: payload.form, eventCallback: goThanks, eventTimeout: 1000 });
          setTimeout(goThanks, 1000);
        })
        .catch(function () {
          errorBox.textContent = 'Не удалось отправить заявку. Попробуйте ещё раз или напишите нам на support@kons-na-bis.com.';
          errorBox.hidden = false;
        })
        .finally(function () { submitBtn.disabled = false; });
    });
  }

  document.querySelectorAll('.lead-form').forEach(initForm);

  // ----- Модальне вікно -----
  var modal = document.getElementById('lead-modal');
  var modalBox = modal.querySelector('.lead-box');
  var modalForm = modalBox.querySelector('.lead-form');
  var lastFocus = null;

  function openModal(kind) {
    var cfg = FORMS[kind] || FORMS.consultation;
    modalForm.elements.form.value = cfg.name;
    modalForm.querySelector('[type="submit"]').textContent = cfg.button;
    showForm(modalBox);
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(function () { modalForm.elements.name.focus(); }, 30);
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  }

  document.addEventListener('click', function (e) {
    var opener = e.target.closest('[data-open-form]');
    if (opener) { e.preventDefault(); openModal(opener.getAttribute('data-open-form')); return; }
    if (e.target.closest('[data-close-modal]')) closeModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });

  // ----- Слайдер «У такому форматі» -----
  document.querySelectorAll('[data-slider]').forEach(function (slider) {
    var track = slider.querySelector('.slider__track');
    var slides = track.children;
    var dotsBox = slider.querySelector('.slider__dots');
    var dots = [];

    function current() { return Math.round(track.scrollLeft / track.clientWidth); }
    function go(i) {
      var n = (i + slides.length) % slides.length;
      track.scrollTo({ left: n * track.clientWidth, behavior: 'smooth' });
    }

    for (var i = 0; i < slides.length; i++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', 'Слайд ' + (i + 1));
      b.addEventListener('click', go.bind(null, i));
      dotsBox.appendChild(b);
      dots.push(b);
    }

    function sync() {
      var c = current();
      dots.forEach(function (d, j) { d.setAttribute('aria-current', String(j === c)); });
    }
    track.addEventListener('scroll', function () { window.requestAnimationFrame(sync); }, { passive: true });
    slider.querySelector('.slider__arrow--prev').addEventListener('click', function () { go(current() - 1); });
    slider.querySelector('.slider__arrow--next').addEventListener('click', function () { go(current() + 1); });
    sync();
  });

  // ----- Експерти: стрілки прокрутки + модальні вікна «Детальніше» -----
  var expertsTrack = document.querySelector('[data-experts-track]');
  if (expertsTrack) {
    var prev = document.querySelector('[data-experts-prev]');
    var next = document.querySelector('[data-experts-next]');
    function step() { var c = expertsTrack.children[0]; return c ? c.getBoundingClientRect().width + 20 : 300; }
    function syncArrows() {
      var max = expertsTrack.scrollWidth - expertsTrack.clientWidth - 2;
      prev.disabled = expertsTrack.scrollLeft <= 2;
      next.disabled = expertsTrack.scrollLeft >= max;
    }
    prev.addEventListener('click', function () { expertsTrack.scrollBy({ left: -step(), behavior: 'smooth' }); });
    next.addEventListener('click', function () { expertsTrack.scrollBy({ left: step(), behavior: 'smooth' }); });
    expertsTrack.addEventListener('scroll', function () { window.requestAnimationFrame(syncArrows); }, { passive: true });
    window.addEventListener('resize', syncArrows);
    syncArrows();
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-expert]');
    if (btn) {
      var dlg = document.getElementById('expert-' + btn.getAttribute('data-expert'));
      if (dlg && dlg.showModal) dlg.showModal();
      return;
    }
    if (e.target.closest('[data-close-expert]')) { e.target.closest('dialog').close(); return; }
    // клік по затемненому фону поза вікном — закрити
    if (e.target.tagName === 'DIALOG' && e.target.classList.contains('expert-modal')) {
      var r = e.target.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close();
    }
  });

  // ----- Рік у футері -----
  document.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });
})();
