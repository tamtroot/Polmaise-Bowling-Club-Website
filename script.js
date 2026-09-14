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
            mobileMenu.setAttribute('aria-expanded', String(isOpen));
            mobileMenu.setAttribute(
                'aria-label',
                isOpen ? 'Close navigation menu' : 'Open navigation menu',
            );

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
                    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                    targetElement.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
                }
            });
        });
    }

    /**
     * Cards and other non-button controls are marked with role="button" so
     * they are focusable. This bridge lets Enter and Space activate them
     * through the existing click handlers, so behaviour stays in one place.
     */
    function initialiseKeyboardActivation() {
        document.addEventListener('keydown', function (event) {
            if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') {
                return;
            }

            const control = event.target.closest('[role="button"]');
            if (!control || control.tagName === 'BUTTON' || control.tagName === 'A') {
                return;
            }

            event.preventDefault();
            control.click();
        });
    }

    function initialiseAccordions() {
        const accordionItems = document.querySelectorAll('.accordion-item');

        accordionItems.forEach(function (item) {
            const header = item.querySelector('.accordion-header');
            if (!header) {
                return;
            }

            header.setAttribute('aria-expanded', String(item.classList.contains('active')));

            header.addEventListener('click', function () {
                accordionItems.forEach(function (otherItem) {
                    if (otherItem !== item && otherItem.classList.contains('active')) {
                        otherItem.classList.remove('active');
                        const otherHeader = otherItem.querySelector('.accordion-header');
                        if (otherHeader) {
                            otherHeader.setAttribute('aria-expanded', 'false');
                        }
                    }
                });

                item.classList.toggle('active');
                header.setAttribute('aria-expanded', String(item.classList.contains('active')));
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
        initialiseKeyboardActivation();
        initialiseAccordions();
        initialiseCustomLightbox();
        initialiseLightboxLibrary();
    });
})();
