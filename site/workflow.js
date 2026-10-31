'use strict';
const controls = document.getElementById('stage-controls');
const buttons = document.querySelectorAll('[data-stage]');
const articles = document.querySelectorAll('[data-content]');
function selectStage(stage) {
  for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.stage === stage));
  for (const article of articles) article.hidden = article.dataset.content !== stage;
}
for (const button of buttons) button.addEventListener('click', () => selectStage(button.dataset.stage));
selectStage('discuss');
controls.hidden = false;
