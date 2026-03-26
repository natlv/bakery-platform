/**
 * Smart Bakers - Master Application Controller
 * Handles: Session Persistence, Role-Based Routing, and Global UI Logic
 */

const SmartBakers = {
    // 1. Session & Data Management
    // Stores user info in the browser so it persists across page refreshes
    session: {
        save: (userId, role, name = "Guest") => {
            localStorage.setItem('sb_user_id', userId);
            localStorage.setItem('sb_role', role); // 'Baker' or 'Customer'
            localStorage.setItem('sb_username', name);
            console.log(`Session started for ${name} as ${role}`);
        },

        get: () => {
            return {
                id: localStorage.getItem('sb_user_id'),
                role: localStorage.getItem('sb_role'),
                name: localStorage.getItem('sb_username')
            };
        },

        clear: () => {
            localStorage.clear();
            window.location.href = 'login.html';
        }
    },

    // 2. Security & Routing Logic
    // Prevents customers from seeing baker pages and vice-versa
    auth: {
        check: () => {
            const user = SmartBakers.session.get();
            const path = window.location.pathname;
            const page = path.split("/").pop();

            // If not logged in and not on login page, send to login
            if (!user.id && page !== 'login.html' && page !== '') {
                window.location.href = 'login.html';
                return;
            }

            // Optional: Role-based restrictions
            if (user.role === 'Baker' && page === 'posting_baking_request.html') {
                alert("Only Customers can post requests.");
                window.location.href = 'bakery_marketplace_dashboard_search.html';
            }
        },

        // Directs user to their specific "Home" based on their role
        goHome: () => {
            const user = SmartBakers.session.get();
            if (user.role === 'Baker') {
                window.location.href = 'bakery_marketplace_dashboard_search.html';
            } else {
                window.location.href = 'main_page_portfolio.html';
            }
        }
    },

    // 3. Global UI Initializer
    // Runs automatically on every page to bind buttons and check auth
    init: () => {
        SmartBakers.auth.check();
        const user = SmartBakers.session.get();

        // Bind all elements with 'data-action' attributes
        document.querySelectorAll('[data-action]').forEach(el => {
            el.onclick = (e) => {
                const action = el.getAttribute('data-action');
                
                if (action === 'logout') SmartBakers.session.clear();
                if (action === 'home') SmartBakers.auth.goHome();
                if (action === 'post-request') window.location.href = 'posting_baking_request.html';
                if (action === 'view-portfolio') window.location.href = 'main_page_portfolio.html';
            };
        });

        // Update any UI elements that should show the user's name
        const nameDisplay = document.getElementById('user-name-display');
        if (nameDisplay && user.name) nameDisplay.textContent = user.name;
    }
};

// Start the controller when the DOM is ready
document.addEventListener('DOMContentLoaded', SmartBakers.init);