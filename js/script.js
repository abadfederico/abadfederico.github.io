document.addEventListener('DOMContentLoaded', function() {
    const video = document.getElementById('miVideo');
    const audioButton = document.getElementById('audioButton');

    audioButton.addEventListener('click', function() {
        if (video.muted) {
            video.muted = false;
            audioButton.textContent = '';
            audioButton.classList.remove('muted');
            audioButton.classList.add('unmuted');
        } else {
            video.muted = true;
            audioButton.textContent = '';
            audioButton.classList.remove('unmuted');
            audioButton.classList.add('muted');
        }
    });

    // Inicialización del botón en estado 'muted'
    audioButton.classList.add('muted');
});