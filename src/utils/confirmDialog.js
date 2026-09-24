// src/utils/confirmDialog.js

/**
 * Show a confirmation dialog
 * @param {string} message - The confirmation message
 * @param {string} title - Optional dialog title
 * @returns {Promise<boolean>} - Resolves to true if confirmed, false otherwise
 */
export const showConfirm = (message, title = 'Confirm') => {
    return new Promise((resolve) => {
        // Create overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            animation: fadeIn 0.2s ease;
        `;

        // Create modal
        const modal = document.createElement('div');
        modal.style.cssText = `
            background: white;
            border-radius: 12px;
            padding: 30px;
            max-width: 400px;
            width: 90%;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            animation: slideUp 0.3s ease;
        `;

        modal.innerHTML = `
            <h3 style="margin: 0 0 10px 0; color: #2c3e50; font-size: 18px;">${title}</h3>
            <p style="margin: 0 0 20px 0; color: #555; font-size: 14px; line-height: 1.5;">${message}</p>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button id="confirmCancel" style="
                    padding: 8px 20px;
                    border: 2px solid #e0e6ed;
                    border-radius: 8px;
                    background: transparent;
                    color: #2c3e50;
                    cursor: pointer;
                    font-weight: 600;
                    font-size: 14px;
                    transition: all 0.3s;
                ">Cancel</button>
                <button id="confirmOk" style="
                    padding: 8px 20px;
                    border: none;
                    border-radius: 8px;
                    background: #e74c3c;
                    color: white;
                    cursor: pointer;
                    font-weight: 600;
                    font-size: 14px;
                    transition: all 0.3s;
                ">Confirm</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Add animation styles if not present
        if (!document.querySelector('#confirm-styles')) {
            const style = document.createElement('style');
            style.id = 'confirm-styles';
            style.textContent = `
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes slideUp {
                    from { transform: translateY(20px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
            `;
            document.head.appendChild(style);
        }

        // Handle button clicks
        const cancelBtn = modal.querySelector('#confirmCancel');
        const confirmBtn = modal.querySelector('#confirmOk');

        const cleanup = (result) => {
            overlay.remove();
            resolve(result);
        };

        cancelBtn.addEventListener('click', () => cleanup(false));
        confirmBtn.addEventListener('click', () => cleanup(true));
        
        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) cleanup(false);
        });

        // Close on Escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                cleanup(false);
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    });
};

// For backward compatibility - use this instead of window.confirm
export const confirmDialog = showConfirm;

// Default export
export default showConfirm;
