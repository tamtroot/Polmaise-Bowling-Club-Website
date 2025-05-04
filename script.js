document.addEventListener('DOMContentLoaded', function() {
    // Mobile menu toggle
    const mobileMenu = document.querySelector('.mobile-menu');
    const navMenu = document.querySelector('nav ul');
    const body = document.body;
    
    if (mobileMenu && navMenu) {
        mobileMenu.addEventListener('click', function(e) {
            e.stopPropagation();
            navMenu.classList.toggle('show');
            
            // Toggle body class to prevent background scrolling
            body.classList.toggle('menu-open');
            
            // Toggle menu icon between bars and X
            const icon = this.querySelector('i');
            const menuText = this.querySelector('.menu-text');
            
            if (icon) {
                icon.classList.toggle('fa-bars');
                icon.classList.toggle('fa-xmark');
            }
            
            if (menuText) {
                menuText.textContent = menuText.textContent === 'Menu' ? 'Close' : 'Menu';
            }
        });

        // Close menu when clicking outside
        document.addEventListener('click', function(event) {
            const isClickInsideMenu = navMenu.contains(event.target);
            const isClickOnToggle = mobileMenu.contains(event.target);
            
            if (!isClickInsideMenu && !isClickOnToggle && navMenu.classList.contains('show')) {
                navMenu.classList.remove('show');
                body.classList.remove('menu-open');
                
                // Reset icon to bars
                const icon = mobileMenu.querySelector('i');
                const menuText = mobileMenu.querySelector('.menu-text');
                
                if (icon) {
                    icon.classList.add('fa-bars');
                    icon.classList.remove('fa-xmark');
                }
                
                if (menuText) {
                    menuText.textContent = 'Menu';
                }
            }
        });

        // Close menu when clicking a link
        const navLinks = document.querySelectorAll('nav ul li a');
        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                navMenu.classList.remove('show');
                body.classList.remove('menu-open');
                
                // Reset icon to bars
                const icon = mobileMenu.querySelector('i');
                const menuText = mobileMenu.querySelector('.menu-text');
                
                if (icon) {
                    icon.classList.add('fa-bars');
                    icon.classList.remove('fa-xmark');
                }
                
                if (menuText) {
                    menuText.textContent = 'Menu';
                }
            });
        });
    }

    // Add mobile responsive styles
    window.addEventListener('resize', function() {
        if (window.innerWidth > 992 && navMenu && navMenu.classList.contains('show')) {
            navMenu.classList.remove('show');
            body.classList.remove('menu-open');
            
            // Reset icon to bars
            const icon = mobileMenu?.querySelector('i');
            const menuText = mobileMenu?.querySelector('.menu-text');
            
            if (icon) {
                icon.classList.add('fa-bars');
                icon.classList.remove('fa-xmark');
            }
            
            if (menuText) {
                menuText.textContent = 'Menu';
            }
        }
    });

    // Add smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;
            
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                targetElement.scrollIntoView({
                    behavior: 'smooth'
                });
            }
        });
    });

    // Accordion functionality
    const accordionItems = document.querySelectorAll('.accordion-item');
    
    accordionItems.forEach(item => {
        const header = item.querySelector('.accordion-header');
        
        header.addEventListener('click', () => {
            // Close all other accordion items
            accordionItems.forEach(otherItem => {
                if (otherItem !== item && otherItem.classList.contains('active')) {
                    otherItem.classList.remove('active');
                }
            });
            
            // Toggle current item
            item.classList.toggle('active');
        });
    });

    // Form validation for contact form
    const contactForm = document.getElementById('contactForm');
    
    if (contactForm) {
        contactForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            let valid = true;
            const name = document.getElementById('name');
            const email = document.getElementById('email');
            const subject = document.getElementById('subject');
            const message = document.getElementById('message');
            
            // Simple validation
            if (!name.value.trim()) {
                highlightInvalid(name);
                valid = false;
            } else {
                removeHighlight(name);
            }
            
            if (!email.value.trim() || !isValidEmail(email.value)) {
                highlightInvalid(email);
                valid = false;
            } else {
                removeHighlight(email);
            }
            
            if (!subject.value.trim()) {
                highlightInvalid(subject);
                valid = false;
            } else {
                removeHighlight(subject);
            }
            
            if (!message.value.trim()) {
                highlightInvalid(message);
                valid = false;
            } else {
                removeHighlight(message);
            }
            
            if (valid) {
                // In a real implementation, you would send the form data to a server
                alert('Thank you for your message! We will get back to you soon.');
                contactForm.reset();
            }
        });
    }
    
    function highlightInvalid(element) {
        element.style.borderColor = '#ff3860';
        const errorMessage = document.createElement('p');
        errorMessage.className = 'error-message';
        errorMessage.textContent = 'This field is required';
        
        // Remove any existing error message
        const existingError = element.parentNode.querySelector('.error-message');
        if (existingError) {
            element.parentNode.removeChild(existingError);
        }
        
        element.parentNode.appendChild(errorMessage);
    }
    
    function removeHighlight(element) {
        element.style.borderColor = '';
        const existingError = element.parentNode.querySelector('.error-message');
        if (existingError) {
            element.parentNode.removeChild(existingError);
        }
    }
    
    function isValidEmail(email) {
        const re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
        return re.test(String(email).toLowerCase());
    }

    // Create a simple image slideshow if there are any on the page
    const slideshows = document.querySelectorAll('.slideshow');
    
    slideshows.forEach(slideshow => {
        const slides = slideshow.querySelectorAll('.slide');
        let currentSlide = 0;
        
        function showSlide(index) {
            slides.forEach((slide, i) => {
                slide.style.display = i === index ? 'block' : 'none';
            });
        }
        
        if (slides.length > 0) {
            showSlide(currentSlide);
            
            setInterval(() => {
                currentSlide = (currentSlide + 1) % slides.length;
                showSlide(currentSlide);
            }, 5000);
        }
    });

    // Direct JavaScript functions for album navigation - globally accessible
    function showSubAlbum(albumId) {
        // Hide the parent album
        document.getElementById('album1').classList.remove('active');
        
        // Show the sub-album
        document.getElementById(albumId).classList.add('active');
        
        // Scroll to the top of the sub-album
        window.scrollTo({
            top: document.getElementById(albumId).offsetTop - 100,
            behavior: 'smooth'
        });
    }

    function closeAlbum(albumId) {
        // Hide all albums
        const albums = document.querySelectorAll('.album-content');
        albums.forEach(album => {
            album.classList.remove('active');
        });
        
        if (albumId) {
            // If an albumId is provided, it means we're closing a sub-album
            // and returning to its parent album
            document.getElementById(albumId).classList.add('active');
        } else {
            // Show the main album cards
            const albumCards = document.querySelectorAll('.album-cards');
            albumCards.forEach(cards => {
                cards.style.display = 'grid';
            });
        }
        
        // Scroll back to the gallery container
        window.scrollTo({
            top: document.querySelector('.gallery-container').offsetTop - 100,
            behavior: 'smooth'
        });
    }

    function backToMainGallery() {
        // Hide all albums
        const albums = document.querySelectorAll('.album-content');
        albums.forEach(album => {
            album.classList.remove('active');
        });
        
        // Show the main album cards
        const albumCards = document.querySelectorAll('.album-cards');
        albumCards.forEach(cards => {
            cards.style.display = 'grid';
        });
        
        // Scroll back to the gallery container
        window.scrollTo({
            top: document.querySelector('.gallery-container').offsetTop - 100,
            behavior: 'smooth'
        });
    }

    // Add event listener to the "Back to 2025 Season" button in the BoA Tea Game album
    const boaTeaBackButton = document.querySelector('#boa-tea .close-album');
    if (boaTeaBackButton) {
        boaTeaBackButton.addEventListener('click', function() {
            document.getElementById('boa-tea').classList.remove('active');
            document.getElementById('album1').classList.add('active');
            
            window.scrollTo({
                top: document.getElementById('album1').offsetTop - 100,
                behavior: 'smooth'
            });
        });
    }

    // Setup event listeners for album navigation in vanilla JS
    const albumCards = document.querySelectorAll('.album-cards > .album-card');
    albumCards.forEach(card => {
        card.addEventListener('click', function() {
            const albumId = this.getAttribute('data-album');
            if (albumId) {
                document.querySelectorAll('.album-cards').forEach(cards => {
                    cards.style.display = 'none';
                });
                document.getElementById(albumId).classList.add('active');
                
                window.scrollTo({
                    top: document.getElementById(albumId).offsetTop - 100,
                    behavior: 'smooth'
                });
            }
        });
    });
    
    // Add listeners to all "Back to Albums" buttons
    const closeButtons = document.querySelectorAll('.close-album');
    closeButtons.forEach(button => {
        if (!button.hasAttribute('onclick')) {
            button.addEventListener('click', function() {
                const parentAlbum = this.closest('.album-content');
                parentAlbum.classList.remove('active');
                
                // Check if this is a sub-album
                if (this.textContent.includes('Back to 2025')) {
                    document.getElementById('album1').classList.add('active');
                } else {
                    document.querySelectorAll('.album-cards').forEach(cards => {
                        cards.style.display = 'grid';
                    });
                }
                
                window.scrollTo({
                    top: document.querySelector('.gallery-container').offsetTop - 100,
                    behavior: 'smooth'
                });
            });
        }
    });
});

$(document).ready(function() {
    // Mobile menu toggle
    $('.mobile-menu').click(function() {
        $('nav ul').toggleClass('show');
    });
    
    // Close mobile menu when a link is clicked
    $('nav ul li a').click(function() {
        if ($('nav ul').hasClass('show')) {
            $('nav ul').removeClass('show');
        }
    });

    // Lightbox configuration
    lightbox.option({
        'resizeDuration': 200,
        'wrapAround': true,
        'albumLabel': 'Image %1 of %2',
        'fadeDuration': 300,
        'imageFadeDuration': 300,
        'positionFromTop': 50,
        'maxWidth': 1200,
        'maxHeight': 900,
        'fitImagesInViewport': true,
        'disableScrolling': false,
        'showImageNumberLabel': true,
        'alwaysShowNavOnTouchDevices': true
    });
    
    // Main album card click functionality
    $('.album-cards > .album-card').click(function() {
        const albumId = $(this).data('album');
        $('.album-cards').hide();
        $('#' + albumId).addClass('active');
        
        // Scroll to the top of the album content
        $('html, body').animate({
            scrollTop: $('#' + albumId).offset().top - 100
        }, 500);
    });
    
    // Sub-album card click functionality within an album
    $('.album-content .album-cards .album-card').click(function() {
        const albumId = $(this).data('album');
        $(this).closest('.album-content').removeClass('active');
        $('#' + albumId).addClass('active');
        
        // Scroll to the top of the sub-album content
        $('html, body').animate({
            scrollTop: $('#' + albumId).offset().top - 100
        }, 500);
    });
    
    // Close album button functionality
    $('.close-album').click(function() {
        const parentAlbum = $(this).closest('.album-content');
        
        // Check if this is a sub-album by looking at the button text
        if ($(this).text().includes('Back to 2025')) {
            // This is a sub-album, go back to the parent album
            parentAlbum.removeClass('active');
            $('#album1').addClass('active');
        } else {
            // This is a main album, go back to the main gallery
            parentAlbum.removeClass('active');
            $('.album-cards').show();
        }
        
        // Scroll back to the appropriate section
        $('html, body').animate({
            scrollTop: $('.gallery-container').offset().top - 100
        }, 500);
    });
}); 