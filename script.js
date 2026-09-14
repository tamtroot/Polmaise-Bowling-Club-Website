(function () {
    'use strict';

    function initialiseMobileNavigation() {
        const mobileMenu = document.querySelector('.mobile-menu');
        const navMenu = document.querySelector('nav ul');
        const mobileDropdown = document.querySelector('.mobile-nav-dropdown');
        const body = document.body;

        if (!mobileMenu || !navMenu) {
            return;
        }

        const icon = mobileMenu.querySelector('i');
        // Must match the CSS breakpoint that swaps the inline navigation for
        // the burger menu (styles.css: max-width 1279px).
        const desktopNavigation = window.matchMedia('(min-width: 1280px)');

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

        if (mobileDropdown) {
            mobileDropdown.querySelectorAll('a').forEach(function (link) {
                link.addEventListener('click', function () {
                    setMenuOpen(false);
                });
            });
        }

        // Any width change that reveals the desktop navigation closes the
        // drawer. One listener, keyed off the same media query the CSS uses.
        const closeIfDesktop = function () {
            if (desktopNavigation.matches && navMenu.classList.contains('show')) {
                setMenuOpen(false);
            }
        };
        window.addEventListener('resize', closeIfDesktop);

        // The body carries `overflow: hidden` while the drawer is open. Never
        // let that state survive a back/forward restore, otherwise the page
        // scrolls not at all and looks frozen. `pageshow` also fires on a
        // normal load (after `load`), so only react to a real restore — a user
        // who opens the menu before the page finishes loading must keep it.
        window.addEventListener('pageshow', function (event) {
            if (event.persisted) {
                setMenuOpen(false);
            }
        });
        window.addEventListener('pagehide', function () {
            setMenuOpen(false);
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
     * Day/night theme toggle. The saved preference is applied before first
     * paint by the inline script in head.njk; this keeps the control in sync
     * and persists changes.
     */
    function initialiseThemeToggle() {
        const toggle = document.querySelector('[data-theme-toggle]');
        if (!toggle) {
            return;
        }

        const root = document.documentElement;
        const storageKey = 'polmaise-theme';

        function applyTheme(mode) {
            const isDark = mode === 'dark';
            root.setAttribute('data-theme', isDark ? 'dark' : 'light');
            toggle.setAttribute('aria-pressed', String(isDark));
            toggle.setAttribute(
                'aria-label',
                isDark ? 'Switch to day theme' : 'Switch to night theme',
            );
        }

        applyTheme(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

        toggle.addEventListener('click', function () {
            const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            applyTheme(next);
            try {
                window.localStorage.setItem(storageKey, next);
            } catch (error) {
                // Private browsing or blocked storage: the theme still applies for this page.
            }
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
        initialiseThemeToggle();
        initialiseSmoothScrolling();
        initialiseKeyboardActivation();
        initialiseAccordions();
        initialiseCustomLightbox();
        initialiseLightboxLibrary();
    });
})();
