// 問題回報：右下角按鈕 + 頁尾連結，透過 FormSubmit 寄到站長信箱
(function () {
    const FEEDBACK_EMAIL = 'second2f@gmail.com';
    const ENDPOINT = 'https://formsubmit.co/ajax/' + FEEDBACK_EMAIL;

    function init() {
        const fab = document.createElement('button');
        fab.type = 'button';
        fab.className = 'feedback-fab';
        fab.setAttribute('aria-label', '回報問題');
        fab.textContent = '回報問題';
        document.body.appendChild(fab);

        const footer = document.querySelector('.footer');
        if (footer) {
            const p = document.createElement('p');
            p.innerHTML = '發現問題或有建議？<a href="#" class="feedback-link">回報給我們</a>';
            footer.appendChild(p);
        }

        const overlay = document.createElement('div');
        overlay.className = 'feedback-overlay';
        overlay.hidden = true;
        overlay.innerHTML =
            '<div class="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedbackTitle">' +
            '  <button type="button" class="feedback-close" aria-label="關閉">&times;</button>' +
            '  <h5 id="feedbackTitle">回報網站問題</h5>' +
            '  <form class="feedback-form">' +
            '    <div class="form-group">' +
            '      <label for="feedbackType">類型</label>' +
            '      <select class="form-control" id="feedbackType" name="類型">' +
            '        <option>計算錯誤</option>' +
            '        <option>頁面顯示異常</option>' +
            '        <option>資料有誤</option>' +
            '        <option>功能建議</option>' +
            '        <option>其他</option>' +
            '      </select>' +
            '    </div>' +
            '    <div class="form-group">' +
            '      <label for="feedbackMessage">問題描述</label>' +
            '      <textarea class="form-control" id="feedbackMessage" name="描述" rows="4" required' +
            '        placeholder="請描述遇到的問題，例如輸入了什麼數字、看到什麼結果"></textarea>' +
            '    </div>' +
            '    <div class="form-group">' +
            '      <label for="feedbackEmail">您的 Email（選填，方便回覆您）</label>' +
            '      <input type="email" class="form-control" id="feedbackEmail" name="email" placeholder="name@example.com">' +
            '    </div>' +
            '    <input type="text" name="_honey" class="feedback-honey" tabindex="-1" autocomplete="off">' +
            '    <p class="feedback-status" aria-live="polite"></p>' +
            '    <button type="submit" class="btn btn-primary btn-block">送出</button>' +
            '  </form>' +
            '</div>';
        document.body.appendChild(overlay);

        const form = overlay.querySelector('.feedback-form');
        const status = overlay.querySelector('.feedback-status');
        const submitBtn = form.querySelector('button[type="submit"]');

        function open(e) {
            if (e) e.preventDefault();
            overlay.hidden = false;
            status.textContent = '';
            status.className = 'feedback-status';
            form.querySelector('textarea').focus();
        }

        function close() {
            overlay.hidden = true;
        }

        fab.addEventListener('click', open);
        document.querySelectorAll('.feedback-link').forEach(function (a) {
            a.addEventListener('click', open);
        });
        overlay.querySelector('.feedback-close').addEventListener('click', close);
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) close();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !overlay.hidden) close();
        });

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            const type = form.querySelector('#feedbackType').value;
            const message = form.querySelector('#feedbackMessage').value.trim();
            const email = form.querySelector('#feedbackEmail').value.trim();
            if (!message) return;

            const payload = {
                _subject: '[網站問題回報] ' + type + ' - ' + document.title,
                _template: 'table',
                _captcha: 'false',
                _honey: form.querySelector('.feedback-honey').value,
                類型: type,
                描述: message,
                頁面: location.href,
                瀏覽器: navigator.userAgent
            };
            if (email) payload.email = email;

            submitBtn.disabled = true;
            status.className = 'feedback-status';
            status.textContent = '送出中…';

            fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(function (res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                })
                .then(function (data) {
                    if (data.success === false || data.success === 'false') throw new Error(data.message);
                    form.reset();
                    status.className = 'feedback-status success';
                    status.textContent = '已送出，感謝您的回報！';
                })
                .catch(function () {
                    // 服務無法使用時改用 mailto，讓使用者用自己的信箱寄出
                    const body = '類型：' + type + '\n頁面：' + location.href + '\n\n' + message;
                    const mailto = 'mailto:' + FEEDBACK_EMAIL +
                        '?subject=' + encodeURIComponent(payload._subject) +
                        '&body=' + encodeURIComponent(body);
                    status.className = 'feedback-status error';
                    status.innerHTML = '送出失敗，請改用 <a href="' + mailto + '">Email 寄送</a>。';
                })
                .finally(function () {
                    submitBtn.disabled = false;
                });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
