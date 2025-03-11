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
}); 