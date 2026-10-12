import '../styles/main.css'; 

const gallery = document.getElementById('gallery');

if (gallery) {
  Promise.all([
    import('photoswipe/lightbox'),
    import('photoswipe/style.css'),
  ]).then(([{ default: PhotoSwipeLightbox }]) => {
    const lightbox = new PhotoSwipeLightbox({
      gallery: '#gallery',
      children: 'a',
      pswpModule: () => import('photoswipe'),
    });

    // Show each photo's caption in the lightbox.
    lightbox.on('uiRegister', () => {
      lightbox.pswp.ui.registerElement({
        name: 'custom-caption',
        order: 9,
        isButton: false,
        appendTo: 'root',
        onInit: (el, pswp) => {
          pswp.on('change', () => {
            const caption = pswp.currSlide.data.element?.closest('figure')?.querySelector('figcaption');
            el.textContent = caption ? caption.textContent : '';
          });
        },
      });
    });

    lightbox.init();
  });
}
