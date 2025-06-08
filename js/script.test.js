const path = require('path');
const { JSDOM } = require('jsdom');

describe('audio button toggle', () => {
  let document;
  let button;

  beforeAll(async () => {
    const dom = await JSDOM.fromFile(path.join(__dirname, '../index.html'), {
      runScripts: 'dangerously',
      resources: 'usable',
    });

    await new Promise(resolve => {
      dom.window.document.addEventListener('DOMContentLoaded', resolve);
    });

    document = dom.window.document;
    button = document.getElementById('audioButton');
  });

  test('toggles classes on click', () => {
    expect(button.classList.contains('muted')).toBe(true);
    expect(button.classList.contains('unmuted')).toBe(false);

    button.click();

    expect(button.classList.contains('unmuted')).toBe(true);
    expect(button.classList.contains('muted')).toBe(false);

    button.click();

    expect(button.classList.contains('muted')).toBe(true);
    expect(button.classList.contains('unmuted')).toBe(false);
  });
});
