(function () {
    'use strict';

    function initialiseMobileNavigation() {
        const mobileMenu = document.querySelector('.mobile-menu');
        const navMenu = document.querySelector('nav ul');
        const body = document.body;

        if (!mobileMenu || !navMenu) {
            return;
        }

        const icon = mobileMenu.querySelector('i');

        function setMenuOpen(isOpen) {
            navMenu.classList.toggle('show', isOpen);
            body.classList.toggle('menu-open', isOpen);

            if (icon) {
                icon.classList.toggle('fa-bars', !isOpen);
                icon.classList.toggle('fa-xmark', isOpen);
            }
        }

        mobileMenu.addEventListener('click', function (event) {
            event.stopPropagation();
            setMenuOpen(!navMenu.classList.contains('show'));
        });

        document.addEventListener('click', function (event) {
            if (
                navMenu.classList.contains('show') &&
                !navMenu.contains(event.target) &&
                !mobileMenu.contains(event.target)
            ) {
                setMenuOpen(false);
            }
        });

        navMenu.querySelectorAll('a').forEach(function (link) {
            link.addEventListener('click', function () {
                setMenuOpen(false);
            });
        });

        window.addEventListener('resize', function () {
            if (window.innerWidth > 992 && navMenu.classList.contains('show')) {
                setMenuOpen(false);
            }
        });
    }

    function initialiseSmoothScrolling() {
        document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
            anchor.addEventListener('click', function (event) {
                event.preventDefault();

                const targetId = this.getAttribute('href');
                if (targetId === '#') {
                    return;
                }

                const targetElement = document.querySelector(targetId);
                if (targetElement) {
                    targetElement.scrollIntoView({ behavior: 'smooth' });
                }
            });
        });
    }

    function initialiseAccordions() {
        const accordionItems = document.querySelectorAll('.accordion-item');

        accordionItems.forEach(function (item) {
            const header = item.querySelector('.accordion-header');
            if (!header) {
                return;
            }

            header.addEventListener('click', function () {
                accordionItems.forEach(function (otherItem) {
                    if (otherItem !== item && otherItem.classList.contains('active')) {
                        otherItem.classList.remove('active');
                    }
                });

                item.classList.toggle('active');
            });
        });
    }

    function initialiseCustomLightbox() {
        const lightbox = document.querySelector('.lightbox');
        if (!lightbox) {
            return;
        }

        const lightboxImage = lightbox.querySelector('.lightbox-content');
        const lightboxCaption = lightbox.querySelector('.lightbox-caption');
        const lightboxClose = lightbox.querySelector('.lightbox-close');

        if (!lightboxImage || !lightboxCaption || !lightboxClose) {
            return;
        }

        function openLightbox(image) {
            lightbox.style.display = 'block';
            lightboxImage.src = image.src;
            lightboxImage.style.touchAction = 'pinch-zoom';
            lightboxCaption.innerHTML = image.alt;
        }

        function closeLightbox() {
            lightbox.style.display = 'none';
        }

        document.addEventListener('click', function (event) {
            const image = event.target.closest('.lightbox-image, .zoomable-image');

            if (image && !lightbox.contains(image)) {
                openLightbox(image);
                return;
            }

            if (event.target === lightbox) {
                closeLightbox();
            }
        });

        lightboxClose.addEventListener('click', closeLightbox);

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && lightbox.style.display === 'block') {
                closeLightbox();
            }
        });
    }

    function initialiseLightboxLibrary() {
        if (!window.lightbox || typeof window.lightbox.option !== 'function') {
            return;
        }

        window.lightbox.option({
            resizeDuration: 200,
            wrapAround: true,
            albumLabel: 'Image %1 of %2',
            fadeDuration: 300,
            imageFadeDuration: 300,
            positionFromTop: 50,
            maxWidth: 1200,
            maxHeight: 900,
            fitImagesInViewport: true,
            disableScrolling: false,
            showImageNumberLabel: true,
            alwaysShowNavOnTouchDevices: true,
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        initialiseMobileNavigation();
        initialiseSmoothScrolling();
        initialiseAccordions();
        initialiseCustomLightbox();
        initialiseLightboxLibrary();
    });
})();
