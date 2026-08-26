document.addEventListener('DOMContentLoaded', function () {
  var buttons = document.querySelectorAll('[data-policy]');
  var policies = document.querySelectorAll('.privacy-policy');

  buttons.forEach(function (button) {
    button.addEventListener('click', function () {
      var target = button.getAttribute('data-policy');

      buttons.forEach(function (item) {
        var active = item === button;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-selected', String(active));
      });
      policies.forEach(function (policy) {
        policy.hidden = policy.id !== target;
      });
    });
  });
});