// Sheek — Admin Dashboard JavaScript

// ── Task completion → Inventory sync ─────────────────────────────────────────
// When a kit/make task is completed, update inventory_items in Supabase.
// Parses: "kit N RecipeName", "kit RecipeName", "make N RecipeName", "make RecipeName", or bare "RecipeName"
async function applyTaskCompletionToInventory(taskText, isCompleted) {
    if (!isCompleted || !taskText || typeof taskText !== 'string') return;
    if (!window.supabaseClient || !window.ORG_ID) return;

    const trimmed = taskText.trim();
    if (!trimmed) return;

    let type = null;
    let qty = 1;
    let recipeName = '';

    const kitMatch = trimmed.match(/^kit\s+(?:(\d+)\s+)?(.+)$/i);
    const makeMatch = trimmed.match(/^make\s+(?:(\d+)\s+)?(.+)$/i);

    if (kitMatch) {
        type = 'kit';
        qty = kitMatch[1] ? parseInt(kitMatch[1], 10) : 1;
        recipeName = kitMatch[2].trim();
    } else if (makeMatch) {
        type = 'make';
        qty = makeMatch[1] ? parseInt(makeMatch[1], 10) : 1;
        recipeName = makeMatch[2].trim();
    } else {
        const { data: recipes } = await window.supabaseClient
            .from('recipes')
            .select('name')
            .eq('org_id', window.ORG_ID)
            .eq('status', 'active');
        const names = (recipes || []).map(r => r.name);
        const exact = names.find(n => String(n || '').trim().toLowerCase() === trimmed.toLowerCase());
        if (exact) {
            type = 'make';
            qty = 1;
            recipeName = String(exact).trim();
        }
    }

    if (!type || !recipeName || qty < 1) return;

    const { data: recipeRow } = await window.supabaseClient
        .from('recipes')
        .select('name, yield_unit')
        .eq('org_id', window.ORG_ID)
        .ilike('name', recipeName)
        .limit(1)
        .maybeSingle();
    const canonicalRecipeName = (recipeRow?.name || recipeName || '').trim();
    recipeName = canonicalRecipeName || recipeName;
    const recipeYieldUnit = (recipeRow?.yield_unit || '').trim() || null;

    const { data: existing } = await window.supabaseClient
        .from('inventory_items')
        .select('id, kitted, quantity_on_hand, unit, yield_per_portion, yield_unit')
        .eq('org_id', window.ORG_ID)
        .ilike('item_name', recipeName)
        .limit(1)
        .maybeSingle();

    let yieldPer = null;
    let yieldUnit = recipeYieldUnit || existing?.yield_unit || 'portions';

    if (type === 'kit') {
        const newKitted = (existing?.kitted ?? 0) + qty;
        const payload = { kitted: newKitted };
        if (existing?.id) {
            await window.supabaseClient.from('inventory_items').update(payload).eq('id', existing.id);
        } else {
            await window.supabaseClient.from('inventory_items').insert({
                org_id: window.ORG_ID,
                item_name: recipeName,
                kitted: newKitted,
                quantity_on_hand: null,
            });
        }
    } else {
        const currentKitted = existing?.kitted ?? 0;
        const newKitted = Math.max(0, currentKitted - qty);
        yieldPer = existing?.yield_per_portion;
        const availUnit = recipeYieldUnit || existing?.unit || yieldUnit;
        const currentAvail = existing?.quantity_on_hand ?? 0;
        const produced = yieldPer != null && yieldPer > 0 ? qty * yieldPer : qty;
        const newAvail = currentAvail + produced;

        const payload = { kitted: newKitted, quantity_on_hand: newAvail, unit: availUnit, yield_unit: yieldUnit };
        if (existing?.id) {
            await window.supabaseClient.from('inventory_items').update(payload).eq('id', existing.id);
        } else {
            await window.supabaseClient.from('inventory_items').insert({
                org_id: window.ORG_ID,
                item_name: recipeName,
                kitted: newKitted,
                quantity_on_hand: newAvail,
                unit: availUnit,
                yield_unit: yieldUnit,
            });
        }
    }

    if (typeof window.tracking !== 'undefined' && window.tracking[recipeName]) {
        const t = window.tracking[recipeName];
        if (type === 'kit') t.kitted = (t.kitted || 0) + qty;
        else {
            t.kitted = Math.max(0, (t.kitted || 0) - qty);
            t.available = (t.available || 0) + (yieldPer != null ? qty * yieldPer : qty);
            t.availUnit = t.availUnit || yieldUnit || 'portions';
        }
        if (typeof window.renderRecipes === 'function') window.renderRecipes();
    }
}

/** Product nav/header title — always Sheek (not orgs.name from DB). */
const KK_APP_BRAND_NAME = 'Sheek';

async function updateOrgBranding() {
    try {
        const orgName = KK_APP_BRAND_NAME;

        // Update nav brand text on all pages
        const brandEls = document.querySelectorAll('.nav-brand span');
        brandEls.forEach(el => { el.textContent = orgName; });

        // Update main header on dashboard if it follows the "<name> Overview" pattern
        const header = document.querySelector('.dashboard-header h1');
        if (header && /Overview$/.test(header.textContent || '')) {
            header.textContent = `${orgName} Overview`;
        }

        // Keep page titles using the product name (do not swap in org DB name)
        if (document.title.includes('Kenny Kitchen')) {
            document.title = document.title.replace('Kenny Kitchen', orgName);
        }
    } catch (e) {
        console.warn('[Branding] Failed to update branding:', e.message);
    }
}

/** Dropdown to switch active restaurant (multi-org managers). */
async function initOrgSwitcher() {
    try {
        if (!window.supabaseClient || typeof window.kkListUserOrgs !== 'function') return;
        if (document.getElementById('kk-org-switcher')) return;
        const nav = document.querySelector('.top-nav');
        if (!nav) return;

        const orgs = await window.kkListUserOrgs();
        if (!orgs || orgs.length <= 1) return;

        const wrap = document.createElement('div');
        wrap.id = 'kk-org-switcher';
        wrap.setAttribute('title', 'Switch restaurant');
        wrap.style.cssText = 'margin-left:10px;display:flex;align-items:center;gap:6px;flex-shrink:0;';

        const label = document.createElement('span');
        label.textContent = 'Location';
        label.style.cssText = 'font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.04em;';
        if (window.matchMedia('(max-width: 900px)').matches) {
            label.style.display = 'none';
        }

        const sel = document.createElement('select');
        sel.style.cssText =
            'max-width:160px;font-size:13px;font-weight:600;color:#1e293b;padding:6px 8px;border-radius:8px;border:1px solid #e2e8f0;background:#fff;cursor:pointer;';
        orgs.forEach((o) => {
            const opt = document.createElement('option');
            opt.value = o.id;
            opt.textContent = o.name || 'Restaurant';
            if (String(o.id) === String(window.ORG_ID || '')) opt.selected = true;
            sel.appendChild(opt);
        });
        sel.addEventListener('change', () => {
            const v = sel.value;
            if (v && typeof window.kkSwitchOrg === 'function') window.kkSwitchOrg(v);
        });

        wrap.appendChild(label);
        wrap.appendChild(sel);

        const brand = nav.querySelector('.nav-brand');
        if (brand && brand.nextElementSibling) {
            nav.insertBefore(wrap, brand.nextElementSibling);
        } else {
            nav.insertBefore(wrap, nav.firstChild);
        }
    } catch (e) {
        console.warn('[Org switcher]', e.message);
    }
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    initializeDashboard();
    updateCurrentTime();
    loadStoredTasks();
    loadUrgentTasks();
    
    // Add event listeners
    setupNavigationTabs();
    setupNotificationActions();
    setupProgressFinishButtons();
    setupTaskFilter();
    setupShiftEmployeeClicks();
    setupNotificationBell();
    setupUrgentTaskInput();
    populateDashboardNotificationList();
    updateOrgBranding();
    initOrgSwitcher();

    // Update task displays after a short delay to ensure user profile is loaded
    setTimeout(() => {
        updateTaskDisplayForCurrentUser();
    }, 100);
});
window.addEventListener('supabase-ready', function() {
    populateDashboardNotificationList();
    updateOrgBranding();
    initOrgSwitcher();
    loadPendingTaskTransferRequests();
    startNotificationPolling();
});

// Initialize dashboard functionality
function initializeDashboard() {
    console.log('Sheek Dashboard initialized');
    
    // Add loading animation
    const cards = document.querySelectorAll('.dashboard-card');
    cards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        
        setTimeout(() => {
            card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, index * 100);
    });
}

// Update current date display
function updateCurrentTime() {
    const now = new Date();
    const dateOptions = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    };
    const titleDateOptions = {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    };
    
    const dateHeaderElement = document.getElementById('current-date-header');
    
    if (dateHeaderElement) {
        dateHeaderElement.textContent = now.toLocaleDateString('en-US', dateOptions);
    }
    
    // Update page title with current date
    const titleDate = now.toLocaleDateString('en-US', titleDateOptions);
    const orgName = KK_APP_BRAND_NAME;
    document.title = `${orgName} - Admin Dashboard | ${titleDate}`;
}

// Setup navigation tab functionality
function setupNavigationTabs() {
    const navTabs = document.querySelectorAll('.nav-tab');
    
    navTabs.forEach(tab => {
        tab.addEventListener('click', function() {
            // Remove active class from all tabs
            navTabs.forEach(t => t.classList.remove('active'));
            
            // Add active class to clicked tab
            this.classList.add('active');
            
            // Get tab name
            const tabName = this.getAttribute('data-tab');
            
            // Handle tab switching (placeholder for now)
            handleTabSwitch(tabName);
        });
    });
}

// Handle tab switching
function handleTabSwitch(tabName) {
    console.log(`Switching to ${tabName} tab`);
    
    // Add visual feedback
    const dashboardHeader = document.querySelector('.dashboard-header h1');
    
    switch(tabName) {
        case 'home':
            dashboardHeader.textContent = 'Dashboard Overview';
            break;
        case 'scheduling':
            dashboardHeader.textContent = 'Scheduling Management';
            showComingSoon('Scheduling features coming soon!');
            break;
        case 'recipes':
            dashboardHeader.textContent = 'Recipe Management';
            showComingSoon('Recipe management features coming soon!');
            break;
        case 'employees':
            dashboardHeader.textContent = 'Employee Management';
            showComingSoon('Employee management features coming soon!');
            break;
        case 'chat':
            dashboardHeader.textContent = 'Team Chat';
            showComingSoon('Team chat features coming soon!');
            break;
        default:
            dashboardHeader.textContent = 'Dashboard Overview';
    }
}

// Show coming soon message
function showComingSoon(message) {
    // Create temporary notification
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #4CAF50;
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        z-index: 10000;
        font-weight: 600;
        transform: translateX(400px);
        transition: transform 0.3s ease;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.transform = 'translateX(400px)';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// Setup notification actions
function setupNotificationActions() {
    const approveButtons = document.querySelectorAll('.btn-approve');
    const denyButtons = document.querySelectorAll('.btn-deny');
    
    approveButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            handleNotificationAction(this, 'approve');
        });
    });
    
    denyButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            handleNotificationAction(this, 'deny');
        });
    });
}

// Store approved drop requests (employee -> array of date strings)
window.approvedDrops = window.approvedDrops || {};
const approvedDrops = window.approvedDrops;

// Handle notification actions
function handleNotificationAction(button, action) {
    const notificationItem = button.closest('.notification-item');
    const notificationContent = notificationItem.querySelector('.notification-content p')?.textContent || '';
    
    // Parse drop request if approved
    if (action === 'approve' && notificationContent.includes('to drop')) {
        parseAndStoreDropRequest(notificationContent);
    }
    
    // Add visual feedback
    button.style.transform = 'scale(0.95)';
    setTimeout(() => {
        button.style.transform = 'scale(1)';
    }, 150);
    
    // Simulate API call
    setTimeout(() => {
        // Remove notification with animation
        notificationItem.style.transition = 'all 0.3s ease';
        notificationItem.style.transform = 'translateX(-100%)';
        notificationItem.style.opacity = '0';
        
        setTimeout(() => {
            notificationItem.remove();
            updateNotificationBadge();
        }, 300);
        
        // Show success message
        const actionText = action === 'approve' ? 'approved' : 'denied';
        showNotificationToast(`Request ${actionText} successfully!`, action === 'approve' ? 'success' : 'error');
        
    }, 500);
}

// Parse drop request text and store approved dates
function parseAndStoreDropRequest(text) {
    // Examples: "Kenny to drop Jan 25" or "Rohan wants Jan 22 to Jan 28 off"
    const dropMatch = text.match(/(\w+)\s+(?:wants|to drop)\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d+)(?:\s+to\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d+))?/i);
    if (!dropMatch) return;
    
    const employeeName = dropMatch[1];
    const startDay = parseInt(dropMatch[2]);
    const endDay = dropMatch[3] ? parseInt(dropMatch[3]) : startDay;
    
    // Extract month (assume current year, or parse from text)
    const monthMatch = text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
    if (!monthMatch) return;
    
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthIndex = monthNames.findIndex(m => m.toLowerCase() === monthMatch[1].toLowerCase());
    if (monthIndex === -1) return;
    
    const currentYear = new Date().getFullYear();
    const dates = [];
    
    // Generate all dates in the range
    for (let day = startDay; day <= endDay; day++) {
        const date = new Date(currentYear, monthIndex, day);
        dates.push(date.toISOString().split('T')[0]); // Format: YYYY-MM-DD
    }
    
    // Store dates for this employee
    if (!window.approvedDrops[employeeName]) {
        window.approvedDrops[employeeName] = [];
    }
    window.approvedDrops[employeeName].push(...dates);
    
    // Remove duplicates
    window.approvedDrops[employeeName] = [...new Set(window.approvedDrops[employeeName])];
}

// Update notification badge count
function updateNotificationBadge() {
    const badge = document.querySelector('.notification-badge');
    const notifications = document.querySelectorAll('.notification-item');
    const count = notifications.length;
    
    if (badge) {
        badge.textContent = count;
        if (count === 0) {
            badge.style.display = 'none';
        }
    }
    
    // Update card badge
    const cardBadge = document.querySelector('.card-badge');
    if (cardBadge) {
        cardBadge.textContent = count === 0 ? 'All Clear' : `${count} New`;
        if (count === 0) {
            cardBadge.style.background = '#4CAF50';
        }
    }
}

// Show notification toast
function showNotificationToast(message, type = 'success') {
    const toast = document.createElement('div');
    const bgColor = type === 'success' ? '#4CAF50' : '#e53e3e';
    
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: ${bgColor};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        z-index: 10000;
        font-weight: 600;
        transform: translateY(100px);
        transition: transform 0.3s ease;
        max-width: 300px;
    `;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    // Animate in
    setTimeout(() => {
        toast.style.transform = 'translateY(0)';
    }, 100);
    
    // Remove after 3 seconds
    setTimeout(() => {
        toast.style.transform = 'translateY(100px)';
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 300);
    }, 3000);
}

// Load stored tasks from scheduling page
function loadStoredTasks() {
    // First, try to load from localStorage
    try {
        const storedTasks = localStorage.getItem('kitchenTasks');
        if (storedTasks) {
            window.kitchenTasks = JSON.parse(storedTasks);
        }
    } catch (e) {
        console.warn('Could not load tasks from localStorage:', e);
    }
    
    // Initialize if not exists
    if (typeof window.kitchenTasks === 'undefined') {
        window.kitchenTasks = [];
    }
    
    const progressList = document.querySelector('.progress-list');
    const emptyMsg = document.getElementById('progress-list-empty-msg');
    
    // Show all assigned incomplete tasks for managers (do not require a matching shift row — that hid tasks when "0 on shift").
    const tasksToShow = window.kitchenTasks.filter(t => {
        const assignee = (t.assignee || '').trim();
        if (!assignee || assignee === 'Unassigned') return false;
        if (t.completed) return false;
        return true;
    });
    
    if (progressList) {
        const existingItems = progressList.querySelectorAll('.progress-item');
        existingItems.forEach(item => item.remove());
        if (emptyMsg) emptyMsg.style.display = tasksToShow.length > 0 ? 'none' : 'block';
    }
    
    if (tasksToShow.length > 0 && progressList) {
        if (emptyMsg) emptyMsg.style.display = 'none';
        
        tasksToShow.forEach(task => {
            if (typeof window.createTaskItem === 'function') {
                window.createTaskItem(progressList, task.assignee, task.description);
            } else {
                        // Fallback: create task item (will be updated by updateTaskItemDisplay)
                        const taskItem = document.createElement('div');
                        taskItem.className = 'progress-item in-progress';
                        taskItem.dataset.employeeName = task.assignee;
                        taskItem.dataset.taskDescription = task.description;
                        taskItem.dataset.completed = 'false';
                        
                        const currentUser = getCurrentUser();
                        const isAssignedToCurrentUser = currentUser && currentUser.toLowerCase() === task.assignee.toLowerCase();
                        
                        if (isAssignedToCurrentUser) {
                            taskItem.innerHTML = `
                                <div class="progress-indicator"></div>
                                <div class="progress-content">
                                    <span class="task-assignee">${escapeHtml(task.assignee)}</span>
                                    <div class="task-description">
                                        <label class="task-checkbox-label">
                                            <input type="checkbox" class="task-checkbox" data-task-id="${Date.now()}">
                                            <span class="task-text">${escapeHtml(task.description)}</span>
                                        </label>
                                    </div>
                                </div>
                            `;
                            
                            const checkbox = taskItem.querySelector('.task-checkbox');
                            if (checkbox) {
                                checkbox.addEventListener('change', function() {
                                    if (typeof window.handleTaskCheckboxChange === 'function') {
                                        window.handleTaskCheckboxChange(taskItem, this);
                                    }
                                });
                            }
                        } else {
                            taskItem.innerHTML = `
                                <div class="progress-indicator"></div>
                                <div class="progress-content">
                                    <span class="task-assignee">${escapeHtml(task.assignee)}</span>
                                    <div class="task-description">
                                        <div class="task-status-readonly">
                                            <i class="fas fa-circle task-status-icon task-status-pending"></i>
                                            <span class="task-text">${escapeHtml(task.description)}</span>
                                        </div>
                                    </div>
                                </div>
                            `;
                        }
                        
                        progressList.appendChild(taskItem);
            }
        });
        
        // Trigger update of shift cards if on scheduling page
        if (typeof checkEmployeeTasks === 'function') {
            setTimeout(() => checkEmployeeTasks(), 100);
        }
    }
    
    updateProgressListEmptyState();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Get current user name
function getCurrentUser() {
    return document.querySelector('.user-profile span')?.textContent?.trim() || '';
}

// Modal functions (if not already defined)
if (typeof openModal === 'undefined') {
    function openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('active');
        }
    }
    window.openModal = openModal;
}

if (typeof closeModal === 'undefined') {
    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
        }
    }
    window.closeModal = closeModal;
}

// Setup progress checkboxes (manual click to complete tasks)
function setupProgressFinishButtons() {
    // Update existing tasks to show checkboxes only for assigned employee
    updateTaskDisplayForCurrentUser();
    
    // Setup checkboxes for existing tasks (only for assigned employee)
    document.querySelectorAll('.task-checkbox').forEach(checkbox => {
        if (!checkbox.dataset.listenerAdded) {
            checkbox.dataset.listenerAdded = 'true';
            checkbox.addEventListener('change', function() {
                const taskItem = this.closest('.progress-item');
                if (taskItem && typeof window.handleTaskCheckboxChange === 'function') {
                    window.handleTaskCheckboxChange(taskItem, this);
                }
            });
        }
    });
    
    // Also handle dynamically added tasks
    const progressList = document.querySelector('.progress-list');
    if (progressList) {
        const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1 && node.classList.contains('progress-item')) {
                        updateTaskItemDisplay(node);
                        const checkbox = node.querySelector('.task-checkbox');
                        if (checkbox && !checkbox.dataset.listenerAdded) {
                            checkbox.dataset.listenerAdded = 'true';
                            checkbox.addEventListener('change', function() {
                                const taskItem = this.closest('.progress-item');
                                if (taskItem && typeof window.handleTaskCheckboxChange === 'function') {
                                    window.handleTaskCheckboxChange(taskItem, this);
                                }
                            });
                        }
                    }
                });
            });
        });
        observer.observe(progressList, { childList: true });
    }
}

// Update task display based on current user
function updateTaskDisplayForCurrentUser() {
    const progressList = document.querySelector('.progress-list');
    if (!progressList) return;
    
    progressList.querySelectorAll('.progress-item').forEach(item => {
        updateTaskItemDisplay(item);
    });
}

// Setup click handlers for employees in shift section
function setupShiftEmployeeClicks() {
    // Use event delegation for dynamically added items
    const shiftList = document.querySelector('.shift-list');
    if (shiftList) {
        shiftList.addEventListener('click', function(e) {
            const employeeNameEl = e.target.closest('.clickable-employee');
            if (employeeNameEl) {
                const shiftItem = employeeNameEl.closest('.shift-item');
                const employeeName = shiftItem?.dataset.employeeName || employeeNameEl.textContent.trim();
                if (employeeName) {
                    openEmployeeTasksModal(employeeName);
                }
            }
        });
    }
}

// Open modal showing employee's tasks organized by finished/unfinished
function openEmployeeTasksModal(employeeName) {
    const modal = document.getElementById('employee-tasks-modal');
    const titleNameEl = document.getElementById('employee-tasks-name');
    const unfinishedList = document.getElementById('unfinished-tasks-list');
    const finishedList = document.getElementById('finished-tasks-list');
    const unfinishedCount = document.getElementById('unfinished-count');
    const finishedCount = document.getElementById('finished-count');
    
    if (!modal || !titleNameEl || !unfinishedList || !finishedList) return;
    
    // Set employee name in title
    titleNameEl.textContent = employeeName;
    
    // Clear lists
    unfinishedList.innerHTML = '';
    finishedList.innerHTML = '';
    
    // Get all tasks for this employee
    const unfinishedTasks = [];
    const finishedTasks = [];
    
    // Check tasks from window.kitchenTasks
    if (typeof window.kitchenTasks !== 'undefined' && window.kitchenTasks.length > 0) {
        window.kitchenTasks.forEach(task => {
            if (task.assignee && task.assignee.toLowerCase() === employeeName.toLowerCase()) {
                if (task.completed) {
                    finishedTasks.push({
                        assignee: task.assignee,
                        description: task.description,
                        completed: true
                    });
                } else {
                    unfinishedTasks.push({
                        assignee: task.assignee,
                        description: task.description,
                        completed: false
                    });
                }
            }
        });
    }
    
    // Check tasks from the progress list
    const progressList = document.querySelector('.progress-list');
    if (progressList) {
        progressList.querySelectorAll('.progress-item').forEach(item => {
            const assignee = item.dataset.employeeName || item.querySelector('.task-assignee')?.textContent?.trim();
            const description = item.dataset.taskDescription || item.querySelector('.task-text')?.textContent?.trim();
            const isCompleted = item.dataset.completed === 'true' || item.classList.contains('task-completed');
            
            if (assignee && assignee.toLowerCase() === employeeName.toLowerCase() && description) {
                // Check if already added
                const taskObj = {
                    assignee: assignee,
                    description: description,
                    completed: isCompleted
                };
                
                const alreadyInUnfinished = unfinishedTasks.some(t => 
                    t.assignee === assignee && t.description === description
                );
                const alreadyInFinished = finishedTasks.some(t => 
                    t.assignee === assignee && t.description === description
                );
                
                if (!alreadyInUnfinished && !alreadyInFinished) {
                    if (isCompleted) {
                        finishedTasks.push(taskObj);
                    } else {
                        unfinishedTasks.push(taskObj);
                    }
                }
            }
        });
    }
    
    // Display unfinished tasks
    if (unfinishedTasks.length > 0) {
        unfinishedTasks.forEach(task => {
            const taskItem = createEmployeeTaskItem(task.assignee, task.description, false);
            unfinishedList.appendChild(taskItem);
        });
    } else {
        unfinishedList.innerHTML = '<p class="no-tasks-message">No unfinished tasks</p>';
    }
    
    // Display finished tasks
    if (finishedTasks.length > 0) {
        finishedTasks.forEach(task => {
            const taskItem = createEmployeeTaskItem(task.assignee, task.description, true);
            finishedList.appendChild(taskItem);
        });
    } else {
        finishedList.innerHTML = '<p class="no-tasks-message">No finished tasks</p>';
    }
    
    // Update counts
    unfinishedCount.textContent = unfinishedTasks.length;
    finishedCount.textContent = finishedTasks.length;
    
    // Show modal
    openModal('employee-tasks-modal');
}

// Create a task item for the employee tasks modal
function createEmployeeTaskItem(employeeName, taskDescription, isCompleted) {
    const currentUser = getCurrentUser();
    const isAssignedToCurrentUser = currentUser && currentUser.toLowerCase() === employeeName.toLowerCase();
    
    const taskItem = document.createElement('div');
    taskItem.className = `employee-task-item ${isCompleted ? 'task-completed' : ''}`;
    taskItem.dataset.employeeName = employeeName;
    taskItem.dataset.taskDescription = taskDescription;
    taskItem.dataset.completed = isCompleted ? 'true' : 'false';
    
    // Create delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete-task';
    deleteBtn.type = 'button';
    deleteBtn.innerHTML = '<i class="fas fa-times"></i>';
    deleteBtn.title = 'Remove task';
    deleteBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (confirm(`Remove task "${taskDescription}" from ${employeeName}?`)) {
            removeTask(employeeName, taskDescription);
            // Refresh the modal display
            openEmployeeTasksModal(employeeName);
        }
    });
    
    if (isAssignedToCurrentUser) {
        // Show checkbox for assigned employee
        const label = document.createElement('label');
        label.className = 'task-checkbox-label';
        label.innerHTML = `
            <input type="checkbox" class="task-checkbox" ${isCompleted ? 'checked' : ''} data-task-id="${Date.now()}">
            <span class="task-text" style="${isCompleted ? 'text-decoration: line-through; opacity: 0.6;' : ''}">${escapeHtml(taskDescription)}</span>
        `;
        
        const checkbox = label.querySelector('.task-checkbox');
        if (checkbox) {
            checkbox.addEventListener('change', function() {
                // Update task completion status
                updateTaskCompletionStatus(employeeName, taskDescription, this.checked);
                // Refresh the modal display
                openEmployeeTasksModal(employeeName);
            });
        }
        
        taskItem.appendChild(label);
    } else {
        // Show read-only status for others
        const readonlyDiv = document.createElement('div');
        readonlyDiv.className = 'task-status-readonly';
        readonlyDiv.innerHTML = `
            <i class="fas ${isCompleted ? 'fa-check-circle task-status-complete' : 'fa-circle task-status-pending'} task-status-icon ${isCompleted ? 'task-status-complete' : 'task-status-pending'}"></i>
            <span class="task-text" style="${isCompleted ? 'text-decoration: line-through; opacity: 0.6;' : ''}">${escapeHtml(taskDescription)}</span>
        `;
        taskItem.appendChild(readonlyDiv);
    }
    
    // Add delete button
    taskItem.appendChild(deleteBtn);
    
    return taskItem;
}

// Remove a task from an employee (if not already defined)
if (typeof window.removeTask === 'undefined') {
    function removeTask(employeeName, taskDescription) {
        // Remove from window.kitchenTasks
        if (typeof window.kitchenTasks !== 'undefined') {
            window.kitchenTasks = window.kitchenTasks.filter(task => 
                !(task.assignee === employeeName && task.description === taskDescription)
            );
            
            // Save to localStorage
            try {
                localStorage.setItem('kitchenTasks', JSON.stringify(window.kitchenTasks));
            } catch (e) {
                console.warn('Could not save tasks to localStorage:', e);
            }
        }
        
        // Remove from progress list on home page
        const progressList = document.querySelector('.progress-list');
        if (progressList) {
            progressList.querySelectorAll('.progress-item').forEach(item => {
                const assignee = item.dataset.employeeName || item.querySelector('.task-assignee')?.textContent?.trim();
                const desc = item.dataset.taskDescription || item.querySelector('.task-text')?.textContent?.trim();
                
                if (assignee === employeeName && desc === taskDescription) {
                    // Animate out
                    item.style.transition = 'all 0.3s ease';
                    item.style.opacity = '0';
                    item.style.transform = 'translateX(-20px)';
                    setTimeout(() => {
                        item.remove();
                        // Update shift card indicators if on scheduling page
                        if (typeof updateEmployeeShiftCards === 'function') {
                            updateEmployeeShiftCards(employeeName);
                        }
                    }, 300);
                }
            });
        }
        
        // Show notification
        if (typeof showNotification === 'function') {
            showNotification(`Task "${taskDescription}" removed from ${employeeName}.`, 'success');
        }
    }
    window.removeTask = removeTask;
}

// Update task completion status across the app
function updateTaskCompletionStatus(employeeName, taskDescription, isCompleted) {
    // Update in progress list
    const progressList = document.querySelector('.progress-list');
    if (progressList) {
        progressList.querySelectorAll('.progress-item').forEach(item => {
            const assignee = item.dataset.employeeName || item.querySelector('.task-assignee')?.textContent?.trim();
            const desc = item.dataset.taskDescription || item.querySelector('.task-text')?.textContent?.trim();
            
            if (assignee && assignee.toLowerCase() === employeeName.toLowerCase() && 
                desc && desc === taskDescription) {
                item.dataset.completed = isCompleted ? 'true' : 'false';
                
                if (isCompleted) {
                    item.classList.add('task-completed');
                    item.classList.remove('in-progress');
                } else {
                    item.classList.remove('task-completed');
                    item.classList.add('in-progress');
                }
                
                // Update checkbox if present
                const checkbox = item.querySelector('.task-checkbox');
                if (checkbox) {
                    checkbox.checked = isCompleted;
                }
                
                // Update text styling
                const taskText = item.querySelector('.task-text');
                if (taskText) {
                    if (isCompleted) {
                        taskText.style.textDecoration = 'line-through';
                        taskText.style.opacity = '0.6';
                    } else {
                        taskText.style.textDecoration = 'none';
                        taskText.style.opacity = '1';
                    }
                }
                
                // Update read-only status icon if present
                const statusIcon = item.querySelector('.task-status-icon');
                if (statusIcon) {
                    if (isCompleted) {
                        statusIcon.classList.remove('task-status-pending');
                        statusIcon.classList.add('task-status-complete');
                        statusIcon.className = 'fas fa-check-circle task-status-icon task-status-complete';
                    } else {
                        statusIcon.classList.remove('task-status-complete');
                        statusIcon.classList.add('task-status-pending');
                        statusIcon.className = 'fas fa-circle task-status-icon task-status-pending';
                    }
                }
                
                // Check if all tasks are complete
                if (isCompleted && typeof window.checkAllTasksComplete === 'function') {
                    window.checkAllTasksComplete(employeeName);
                }
            }
        });
    }
    
    // Update window.kitchenTasks if it exists
    if (typeof window.kitchenTasks !== 'undefined') {
        window.kitchenTasks.forEach(task => {
            if (task.assignee && task.assignee.toLowerCase() === employeeName.toLowerCase() &&
                task.description === taskDescription) {
                task.completed = isCompleted;
            }
        });
    }
}

// Update individual task item display
function updateTaskItemDisplay(taskItem) {
    const employeeName = taskItem.dataset.employeeName || taskItem.querySelector('.task-assignee')?.textContent?.trim();
    const currentUser = getCurrentUser();
    const isAssignedToCurrentUser = currentUser && currentUser.toLowerCase() === employeeName?.toLowerCase();
    
    if (!employeeName) return;
    
    // Get task description
    const taskTextEl = taskItem.querySelector('.task-text');
    const taskDescription = taskTextEl?.textContent?.trim() || taskItem.dataset.taskDescription || '';
    const isCompleted = taskItem.dataset.completed === 'true' || taskItem.classList.contains('task-completed');
    
    // Check if already has correct display
    const hasCheckbox = taskItem.querySelector('.task-checkbox');
    const hasReadOnly = taskItem.querySelector('.task-status-readonly');
    
    if (isAssignedToCurrentUser && !hasCheckbox) {
        // Should have checkbox but doesn't - convert read-only to checkbox
        const readonlyEl = taskItem.querySelector('.task-status-readonly');
        if (readonlyEl) {
            const taskText = readonlyEl.querySelector('.task-text')?.textContent || taskDescription;
            readonlyEl.outerHTML = `
                <label class="task-checkbox-label">
                    <input type="checkbox" class="task-checkbox" ${isCompleted ? 'checked' : ''} data-task-id="${Date.now()}">
                    <span class="task-text">${escapeHtml(taskText)}</span>
                </label>
            `;
            
            const checkbox = taskItem.querySelector('.task-checkbox');
            if (checkbox) {
                checkbox.addEventListener('change', function() {
                    if (typeof window.handleTaskCheckboxChange === 'function') {
                        window.handleTaskCheckboxChange(taskItem, this);
                    }
                });
            }
        }
    } else if (!isAssignedToCurrentUser && !hasReadOnly) {
        // Should have read-only but doesn't - convert checkbox to read-only
        const checkboxLabel = taskItem.querySelector('.task-checkbox-label');
        if (checkboxLabel) {
            const taskText = checkboxLabel.querySelector('.task-text')?.textContent || taskDescription;
            const isChecked = checkboxLabel.querySelector('.task-checkbox')?.checked || isCompleted;
            checkboxLabel.outerHTML = `
                <div class="task-status-readonly">
                    <i class="fas ${isChecked ? 'fa-check-circle task-status-complete' : 'fa-circle task-status-pending'} task-status-icon ${isChecked ? 'task-status-complete' : 'task-status-pending'}"></i>
                    <span class="task-text" style="${isChecked ? 'text-decoration: line-through; opacity: 0.6;' : ''}">${escapeHtml(taskText)}</span>
                </div>
            `;
        }
    }
}

// Handle checkbox change (defined in scheduling.js, but also available here)
if (typeof handleTaskCheckboxChange === 'undefined') {
    function handleTaskCheckboxChange(taskItem, checkbox) {
        if (checkbox.checked) {
            const taskDescription = taskItem.dataset.taskDescription || taskItem.querySelector('.task-text')?.textContent?.trim();
            if (taskDescription && typeof applyTaskCompletionToInventory === 'function') {
                applyTaskCompletionToInventory(taskDescription, true);
            }
            // Mark as complete
            taskItem.classList.add('task-completed');
            taskItem.classList.remove('in-progress');
            const taskText = taskItem.querySelector('.task-text');
            if (taskText) {
                taskText.style.textDecoration = 'line-through';
                taskText.style.opacity = '0.6';
            }
            
            // Check if all tasks for this employee are complete
            const employeeName = taskItem.dataset.employeeName || taskItem.querySelector('.task-assignee')?.textContent.trim();
            if (employeeName && typeof checkAllTasksComplete === 'function') {
                checkAllTasksComplete(employeeName);
            } else {
                // Fallback: remove after delay
                setTimeout(() => {
                    taskItem.style.transition = 'all 0.4s ease';
                    taskItem.style.opacity = '0';
                    taskItem.style.transform = 'translateX(-20px)';
                    setTimeout(() => {
                        taskItem.remove();
                        if (employeeName && typeof updateEmployeeShiftCards === 'function') {
                            setTimeout(() => updateEmployeeShiftCards(employeeName), 100);
                        }
                    }, 400);
                }, 1000);
            }
        } else {
            // Mark as incomplete
            taskItem.classList.remove('task-completed');
            taskItem.classList.add('in-progress');
            const taskText = taskItem.querySelector('.task-text');
            if (taskText) {
                taskText.style.textDecoration = 'none';
                taskText.style.opacity = '1';
            }
        }
    }
}

// Check if all tasks for an employee are complete (defined in scheduling.js, but also available here)
if (typeof checkAllTasksComplete === 'undefined') {
    function checkAllTasksComplete(employeeName) {
        const employeeTasks = document.querySelectorAll(`[data-employee-name="${employeeName}"]`);
        if (employeeTasks.length === 0) {
            // Try alternative selector
            const allTasks = document.querySelectorAll('.progress-item');
            const empTasks = Array.from(allTasks).filter(item => {
                const assignee = item.querySelector('.task-assignee')?.textContent.trim();
                return assignee === employeeName;
            });
            
            const allChecked = empTasks.every(item => {
                const checkbox = item.querySelector('.task-checkbox');
                return checkbox && checkbox.checked;
            });
            
            if (allChecked && empTasks.length > 0) {
                setTimeout(() => {
                    empTasks.forEach(item => {
                        item.style.transition = 'all 0.4s ease';
                        item.style.opacity = '0';
                        item.style.transform = 'translateX(-20px)';
                        setTimeout(() => {
                            item.remove();
                            if (typeof updateEmployeeShiftCards === 'function') {
                                setTimeout(() => updateEmployeeShiftCards(employeeName), 100);
                            }
                        }, 400);
                    });
                }, 1000);
            }
            return;
        }
        
        const allChecked = Array.from(employeeTasks).every(item => {
            const checkbox = item.querySelector('.task-checkbox');
            return checkbox && checkbox.checked;
        });
        
        if (allChecked && employeeTasks.length > 0) {
            setTimeout(() => {
                employeeTasks.forEach(item => {
                    item.style.transition = 'all 0.4s ease';
                    item.style.opacity = '0';
                    item.style.transform = 'translateX(-20px)';
                    setTimeout(() => {
                        item.remove();
                        if (typeof updateEmployeeShiftCards === 'function') {
                            setTimeout(() => updateEmployeeShiftCards(employeeName), 100);
                        }
                    }, 400);
                });
            }, 1000);
        }
    }
}

// Mark a task as complete and remove it with animation
function markTaskComplete(progressItem) {
    if (!progressItem) return;
    
    const taskDescription = progressItem.querySelector('.task-description')?.textContent || 'Task';
    const assigneeEl = progressItem.querySelector('.task-assignee');
    const employeeName = assigneeEl?.textContent.trim();
    
    progressItem.style.background = '#f0fff4';
    progressItem.style.border = '2px solid #4CAF50';
    progressItem.querySelector('.btn-finish')?.remove();
    
    const checkmark = document.createElement('div');
    checkmark.className = 'task-complete-check';
    checkmark.innerHTML = '<i class="fas fa-check-circle"></i> Done';
    progressItem.appendChild(checkmark);
    
    progressItem.classList.remove('in-progress');
    progressItem.classList.add('completed');
    
    showNotificationToast(`"${taskDescription}" marked complete!`, 'success');

    // Sync kit/make completion to inventory
    if (typeof applyTaskCompletionToInventory === 'function') {
        applyTaskCompletionToInventory(taskDescription, true);
    }

    // Sync to Supabase
    if (window.supabaseClient && window.ORG_ID) {
        const localTask = (window.kitchenTasks || []).find(t => t.description === taskDescription);
        const q = window.supabaseClient.from('tasks')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('org_id', window.ORG_ID);
        const update = localTask?.supabase_id
            ? q.eq('id', localTask.supabase_id)
            : q.eq('text', taskDescription);
        update.then(({ error }) => {
            if (error) console.warn('[Supabase] markTaskComplete failed:', error.message);
        });
    }
    
    // Remove from list after a short delay
    setTimeout(() => {
        progressItem.style.transition = 'all 0.4s ease';
        progressItem.style.opacity = '0';
        progressItem.style.transform = 'translateX(-20px)';
        setTimeout(() => {
            progressItem.remove();
            
            // Update shift cards on scheduling page if employee has no more tasks
            if (employeeName && typeof updateEmployeeShiftCards === 'function') {
                setTimeout(() => updateEmployeeShiftCards(employeeName), 100);
            }
        }, 400);
    }, 1500);
}

// Setup task filter dropdown
function setupTaskFilter() {
    const filterSelect = document.getElementById('filter-employee-tasks');
    if (!filterSelect) return;
    
    // Populate employee list from existing tasks
    updateEmployeeFilterList();
    
    // Update filter and empty state when tasks are added/removed
    const progressList = document.querySelector('.progress-list');
    if (progressList) {
        const observer = new MutationObserver(() => {
            updateEmployeeFilterList();
            updateProgressListEmptyState();
        });
        observer.observe(progressList, { childList: true, subtree: true });
    }
}

// Update the "no tasks" message visibility on the home page
function updateProgressListEmptyState() {
    const progressList = document.querySelector('.progress-list');
    const emptyMsg = document.getElementById('progress-list-empty-msg');
    if (!progressList || !emptyMsg) return;
    const hasItems = progressList.querySelectorAll('.progress-item').length > 0;
    emptyMsg.style.display = hasItems ? 'none' : 'block';
}

// Setup notification bell click handler (available globally)
// ── Notification Dropdown ─────────────────────────────────────────────────────

function supabaseErrText(err) {
    if (!err) return '';
    return [err.message, err.details, err.hint].filter(Boolean).join(' ');
}

const NOTIF_DAYS = 3; // Show notifications from last N days in bell

/** Org tasks — order by id first (avoids 400 when created_at column missing). */
async function fetchTasksForOrgOrdered() {
    if (!window.supabaseClient || !window.ORG_ID) return { data: [], error: null };
    const base = () =>
        window.supabaseClient.from('tasks').select('*').eq('org_id', window.ORG_ID);
    let res = await base().order('id', { ascending: true });
    if (res.error && /column|does not exist|400/i.test(supabaseErrText(res.error))) {
        res = await base();
    }
    return res;
}

async function fetchNotificationsFromSupabase(daysBack = NOTIF_DAYS) {
    if (!window.supabaseClient || !window.ORG_ID) return [];
    const since = new Date();
    since.setDate(since.getDate() - daysBack);
    const sinceMs = since.getTime();
    const c = window.supabaseClient;
    const org = window.ORG_ID;
    // Avoid SQL filters on created_at/order(created_at) — old DBs lack the column → 400 spam.
    // Fetch by org, filter last N days in JS.
    let res = await c
        .from('notifications')
        .select('*')
        .eq('org_id', org)
        .order('id', { ascending: false })
        .limit(400);
    if (res.error) {
        res = await c.from('notifications').select('*').eq('org_id', org).limit(400);
    }
    if (res.error) {
        console.warn('[Supabase] Notifications load failed:', supabaseErrText(res.error));
        return [];
    }
    const data = (res.data || []).filter((n) => {
        const t = n.created_at || n.inserted_at;
        if (!t) return true;
        return new Date(t).getTime() >= sinceMs;
    });
    const iconMap = { task_assigned: 'fas fa-clipboard-list', shift_assigned: 'fas fa-calendar-check', request_approved: 'fas fa-check-circle', request_denied: 'fas fa-times-circle', open_shift: 'fas fa-calendar-plus', task_transfer_request: 'fas fa-exchange-alt', shift_request: 'fas fa-clock' };
    return (data || []).map(n => ({
        id: n.id,
        text: n.body || n.title || n.message || n.text || n.type || 'Notification',
        time: formatNotifTime(n.created_at || n.inserted_at),
        priority: 'high',
        iconClass: iconMap[n.type] || 'fas fa-bell',
        hasActions: false,
        read: n.read,
        employee_name: n.employee_name,
    }));
}

function formatNotifTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    return d.toLocaleDateString();
}

async function getNotifications() {
    return await fetchNotificationsFromSupabase(NOTIF_DAYS);
}

// Populate dashboard Notifications card from Supabase only (no hardcoded items)
async function populateDashboardNotificationList() {
    const listEl = document.getElementById('dashboard-notification-list');
    const badgeEl = document.getElementById('dashboard-notif-badge');
    const emptyEl = document.getElementById('dashboard-notif-empty');
    if (!listEl) return;
    const notifications = await getNotifications();
    const unread = notifications.filter(n => !n.read).length;
    if (badgeEl) {
        badgeEl.textContent = unread;
        badgeEl.style.display = unread ? '' : 'none';
    }
    if (notifications.length === 0) {
        if (emptyEl) emptyEl.style.display = '';
        listEl.querySelectorAll('.notification-item').forEach(el => el.remove());
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    listEl.querySelectorAll('.notification-item').forEach(el => el.remove());
    notifications.forEach(n => {
        const item = document.createElement('div');
        item.className = 'notification-item priority-high' + (n.read ? ' notif-read' : '');
        item.dataset.notifId = n.id;
        const who = n.employee_name ? ` <small style="color:#718096;">→ ${escapeHtml(n.employee_name)}</small>` : '';
        item.innerHTML = `
            <div class="notification-icon"><i class="${n.iconClass || 'fas fa-bell'}"></i></div>
            <div class="notification-content">
                <p>${escapeHtml(n.text)}${who}</p>
                <span class="notification-time">${escapeHtml(n.time)}</span>
            </div>
        `;
        listEl.appendChild(item);
    });
}

// Poll notifications every 30 s so new task-transfer / shift-assign alerts appear without refresh
let _notifPollTimer = null;
function startNotificationPolling() {
    if (_notifPollTimer) return;
    _notifPollTimer = setInterval(() => {
        populateDashboardNotificationList();
        updateNavNotifBadge();
    }, 30000);
}

// Fetch pending task transfer requests and show them as dashboard notifications
async function loadPendingTaskTransferRequests() {
    if (!window.supabaseClient || !window.ORG_ID) return;
    try {
        const { data, error } = await window.supabaseClient
            .from('task_transfer_requests')
            .select('*')
            .eq('org_id', window.ORG_ID)
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(50);
        if (error) {
            console.warn('[TaskTransfer] Could not load pending requests:', error.message);
            return;
        }
        renderTaskTransferRequests(data || []);
    } catch (e) {
        console.warn('[TaskTransfer] loadPendingTaskTransferRequests error:', e?.message || e);
    }
}

function renderTaskTransferRequests(requests) {
    const listEl = document.getElementById('dashboard-notification-list');
    if (!listEl) return;
    listEl.querySelectorAll('.task-transfer-item').forEach(el => el.remove());
    if (!requests.length) return;
    requests.forEach(r => {
        const item = document.createElement('div');
        item.className = 'notification-item priority-high task-transfer-item';
        item.dataset.transferId = r.id;
        item.innerHTML = `
            <div class="notification-icon"><i class="fas fa-exchange-alt"></i></div>
            <div class="notification-content" style="flex:1">
                <p><strong>Task Transfer:</strong> ${escapeHtml(r.from_employee_name)} → ${escapeHtml(r.to_employee_name)}</p>
                <span class="notification-time">${formatNotifTime(r.created_at)}</span>
                <div style="margin-top:6px;display:flex;gap:6px;">
                    <button class="btn-approve-transfer" data-id="${r.id}" data-task="${r.task_id}" data-to="${escapeHtml(r.to_employee_name)}"
                            style="background:#48bb78;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;">
                        Approve
                    </button>
                    <button class="btn-decline-transfer" data-id="${r.id}"
                            style="background:#e53e3e;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;">
                        Decline
                    </button>
                </div>
            </div>
        `;
        listEl.prepend(item);
    });
    listEl.querySelectorAll('.btn-approve-transfer').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const taskId = btn.dataset.task;
            const toName = btn.dataset.to;
            await handleTaskTransferAction(id, taskId, toName, 'accepted');
        });
    });
    listEl.querySelectorAll('.btn-decline-transfer').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            await handleTaskTransferAction(id, null, null, 'declined');
        });
    });
}

async function handleTaskTransferAction(requestId, taskId, toEmployeeName, action) {
    if (!window.supabaseClient || !window.ORG_ID) return;
    try {
        if (action === 'accepted' && taskId && toEmployeeName) {
            await window.supabaseClient
                .from('tasks')
                .update({ employee_name: toEmployeeName })
                .eq('id', taskId);
        }
        await window.supabaseClient
            .from('task_transfer_requests')
            .update({ status: action })
            .eq('id', requestId);
        const el = document.querySelector(`[data-transfer-id="${requestId}"]`);
        if (el) el.remove();
        const label = action === 'accepted' ? 'approved' : 'declined';
        if (typeof showNotification === 'function') showNotification(`Task transfer ${label}.`, 'success');
        loadPendingTaskTransferRequests();
    } catch (e) {
        console.warn('[TaskTransfer] handleTaskTransferAction error:', e?.message || e);
    }
}

async function buildNotifDropdown(bell) {
    bell.querySelector('.notif-dropdown')?.remove();

    const notifications = await getNotifications();
    const unreadCount = notifications.filter(n => !n.read).length;

    const panel = document.createElement('div');
    panel.className = 'notif-dropdown';

    const header = document.createElement('div');
    header.className = 'notif-dropdown-header';
    header.innerHTML = `
        <h3><i class="fas fa-bell"></i> Notifications (last ${NOTIF_DAYS} days)${notifications.length ? ` <span class="notification-badge" style="position:static;margin-left:0.25rem;">${notifications.length}</span>` : ''}</h3>
        <button class="notif-clear-btn" id="notif-clear-all">Mark all read</button>
    `;
    panel.appendChild(header);

    const list = document.createElement('div');
    list.className = 'notif-dropdown-list';

    if (notifications.length === 0) {
        list.innerHTML = `<div class="notif-dropdown-empty"><i class="fas fa-check-circle"></i>No notifications in the last ${NOTIF_DAYS} days</div>`;
    } else {
        notifications.forEach(n => {
            const item = document.createElement('div');
            item.className = 'notif-dropdown-item' + (n.read ? ' notif-read' : '');
            item.dataset.notifId = n.id;
            const who = n.employee_name ? ` <small style="color:#718096;">→ ${n.employee_name}</small>` : '';
            item.innerHTML = `
                <div class="notif-icon ${n.priority || 'info'}"><i class="${n.iconClass}"></i></div>
                <div class="notif-body">
                    <p class="notif-text">${escapeHtml(n.text)}${who}</p>
                    <span class="notif-time">${escapeHtml(n.time)}</span>
                </div>
            `;
            item.addEventListener('click', () => markNotificationRead(n.id, bell));
            list.appendChild(item);
        });
    }

    panel.appendChild(list);

    const footer = document.createElement('div');
    footer.className = 'notif-dropdown-footer';
    footer.innerHTML = `<a href="#" id="notif-view-history">View full history</a>`;
    footer.querySelector('#notif-view-history').addEventListener('click', e => {
        e.preventDefault();
        closeNotifDropdown(bell);
        openNotificationHistoryModal();
    });
    panel.appendChild(footer);

    bell.appendChild(panel);

    panel.querySelector('#notif-clear-all')?.addEventListener('click', async e => {
        e.stopPropagation();
        await markAllNotificationsRead();
        closeNotifDropdown(bell);
        updateNavNotifBadge();
        buildNotifDropdown(bell);
    });

    return panel;
}

function escapeHtml(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

async function markNotificationRead(id, bell) {
    if (!window.supabaseClient || !window.ORG_ID) return;
    await window.supabaseClient.from('notifications').update({ read: true }).eq('id', id);
    const item = bell?.querySelector(`[data-notif-id="${id}"]`);
    if (item) item.classList.add('notif-read');
    updateNavNotifBadge();
}

async function markAllNotificationsRead() {
    if (!window.supabaseClient || !window.ORG_ID) return;
    const since = new Date();
    since.setDate(since.getDate() - NOTIF_DAYS);
    const q = window.supabaseClient
        .from('notifications')
        .update({ read: true })
        .eq('org_id', window.ORG_ID)
        .gte('created_at', since.toISOString());
    let r = await q;
    if (r.error && /created_at|column|does not exist/i.test(supabaseErrText(r.error))) {
        r = await window.supabaseClient
            .from('notifications')
            .update({ read: true })
            .eq('org_id', window.ORG_ID);
    }
}

function updateNavNotifBadge() {
    (async () => {
        const notifs = await fetchNotificationsFromSupabase(NOTIF_DAYS);
        const unread = notifs.filter(n => !n.read).length;
        const badge = document.getElementById('nav-notif-badge') || document.querySelector('.notification-bell .notification-badge');
        if (badge) {
            badge.textContent = unread;
            badge.style.display = unread ? '' : 'none';
        }
    })();
}

async function openNotificationHistoryModal() {
    const all = await fetchNotificationsFromSupabase(30);
    let modal = document.getElementById('notification-history-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'notification-history-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal" style="max-width:480px;">
                <div class="modal-header">
                    <h3><i class="fas fa-history"></i> Notification History</h3>
                    <button class="modal-close" onclick="document.getElementById('notification-history-modal').classList.remove('active');document.body.style.overflow='';">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="notif-history-list" style="max-height:400px;overflow-y:auto;"></div>
                </div>
            </div>
        `;
        modal.addEventListener('click', e => { if (e.target === modal) { modal.classList.remove('active'); document.body.style.overflow = ''; } });
        document.body.appendChild(modal);
    }
    const list = modal.querySelector('.notif-history-list');
    list.innerHTML = all.length === 0
        ? '<p style="text-align:center;color:#a0aec0;padding:2rem;">No notifications in the last 30 days.</p>'
        : all.map(n => `
            <div class="notif-history-item ${n.read ? 'notif-read' : ''}">
                <i class="${n.iconClass || 'fas fa-bell'}" style="margin-right:8px;color:#718096;"></i>
                <div>
                    <p style="margin:0 0 4px 0;">${escapeHtml(n.text)}</p>
                    <span style="font-size:11px;color:#a0aec0;">${escapeHtml(n.time)}${n.employee_name ? ' • ' + escapeHtml(n.employee_name) : ''}</span>
                </div>
            </div>
        `).join('');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function openNotifDropdown(bell) {
    buildNotifDropdown(bell).then(() => {
        requestAnimationFrame(() => bell.querySelector('.notif-dropdown')?.classList.add('open'));
    });
}

function closeNotifDropdown(bell) {
    bell.querySelector('.notif-dropdown')?.classList.remove('open');
}

function setupNotificationBell() {
    const notificationBell = document.querySelector('.notification-bell');
    if (!notificationBell) return;

    // Remove any existing listeners to avoid duplicates
    const newBell = notificationBell.cloneNode(true);
    notificationBell.parentNode.replaceChild(newBell, notificationBell);

    newBell.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();

        const isOpen = newBell.querySelector('.notif-dropdown.open');
        if (isOpen) {
            closeNotifDropdown(newBell);
        } else {
            openNotifDropdown(newBell);
        }
    });

    // Close when clicking outside
    document.addEventListener('click', function(e) {
        if (!newBell.contains(e.target)) {
            closeNotifDropdown(newBell);
        }
    });

    // Close on Escape
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') closeNotifDropdown(newBell);
    });
}

// Make setupNotificationBell globally available
window.setupNotificationBell = setupNotificationBell;

// Update employee filter dropdown with current employees who have tasks
function updateEmployeeFilterList() {
    const filterSelect = document.getElementById('filter-employee-tasks');
    if (!filterSelect) return;
    
    const currentValue = filterSelect.value;
    const progressList = document.querySelector('.progress-list');
    if (!progressList) return;
    
    // Get unique employee names from tasks
    const employees = new Set();
    progressList.querySelectorAll('.task-assignee').forEach(el => {
        const name = el.textContent.trim();
        if (name) employees.add(name);
    });
    
    // Update dropdown
    filterSelect.innerHTML = '<option value="">All Employees</option>';
    Array.from(employees).sort().forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        filterSelect.appendChild(option);
    });
    
    // Restore previous selection
    if (currentValue) {
        filterSelect.value = currentValue;
    }
}

// Filter tasks by employee
function filterTasksByEmployee() {
    const filterSelect = document.getElementById('filter-employee-tasks');
    const selectedEmployee = filterSelect?.value || '';
    const progressList = document.getElementById('progress-list') || document.querySelector('.progress-list');
    
    if (!progressList) return;
    
    const taskItems = progressList.querySelectorAll('.progress-item');
    taskItems.forEach(item => {
        const assignee = item.querySelector('.task-assignee')?.textContent.trim();
        if (!selectedEmployee || assignee === selectedEmployee) {
            item.style.display = '';
        } else {
            item.style.display = 'none';
        }
    });
}

// Refresh progress function — reload shifts and tasks from Supabase
async function refreshProgress() {
    const refreshBtn = document.querySelector('.btn-refresh i');
    if (refreshBtn) {
        refreshBtn.style.transition = 'transform 0.5s ease';
        refreshBtn.style.transform = 'rotate(360deg)';
        setTimeout(() => { refreshBtn.style.transform = 'rotate(0deg)'; }, 500);
    }
    if (window.supabaseClient && window.ORG_ID) {
        if (typeof loadEmployeePositionsFromSupabase === 'function') {
            await loadEmployeePositionsFromSupabase();
        }
        await loadTodayShifts();
        const { data: tasks, error } = await fetchTasksForOrgOrdered();
        if (!error && tasks) {
            if (typeof window.kitchenTasks === 'undefined') window.kitchenTasks = [];
            let changed = false;
            tasks.forEach(task => {
                const local = window.kitchenTasks.find(t => t.supabase_id === task.id);
                const mappedName = (typeof window.getEmployeeNameFromId === 'function' ? window.getEmployeeNameFromId(task.employee_id) : null) || 'Unassigned';
                if (local) {
                    if (local.completed !== (task.status === 'completed')) {
                        local.completed = task.status === 'completed';
                        changed = true;
                    }
                    if (local.assignee !== mappedName) {
                        local.assignee = mappedName;
                        changed = true;
                    }
                    if (task.shift_id && String(local.shift_id || '') !== String(task.shift_id)) {
                        local.shift_id = task.shift_id;
                        changed = true;
                    }
                } else if (task.status !== 'completed') {
                    const row = {
                        assignee: mappedName,
                        description: task.text,
                        timestamp: task.created_at,
                        completed: false,
                        supabase_id: task.id
                    };
                    if (task.shift_id) row.shift_id = task.shift_id;
                    window.kitchenTasks.push(row);
                    changed = true;
                }
            });
            if (changed) localStorage.setItem('kitchenTasks', JSON.stringify(window.kitchenTasks));
            loadStoredTasks();
            if (typeof loadUrgentTasks === 'function') loadUrgentTasks();
            if (typeof updateNavNotifBadge === 'function') updateNavNotifBadge();
        }
    }
    showNotificationToast('Progress data refreshed!', 'success');
}

// Add smooth scrolling for better UX
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Add keyboard shortcuts
document.addEventListener('keydown', function(e) {
    // Alt + 1-5 for tab switching
    if (e.altKey && e.key >= '1' && e.key <= '5') {
        e.preventDefault();
        const tabIndex = parseInt(e.key) - 1;
        const tabs = document.querySelectorAll('.nav-tab');
        if (tabs[tabIndex]) {
            tabs[tabIndex].click();
        }
    }
    
    // Ctrl/Cmd + R for refresh (prevent default and use custom refresh)
    if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault();
        refreshProgress();
    }
});

// Add window resize handler for responsive adjustments
window.addEventListener('resize', function() {
    const dashboardGrid = document.querySelector('.dashboard-grid');
    if (!dashboardGrid) return;
    if (window.innerWidth <= 768) {
        dashboardGrid.style.gridTemplateColumns = '1fr';
    } else if (window.innerWidth <= 1200) {
        dashboardGrid.style.gridTemplateColumns = '1fr 1fr';
    } else {
        dashboardGrid.style.gridTemplateColumns = '1fr 1fr 1fr';
    }
});

// Export functions for global access
window.refreshProgress = refreshProgress;

// ── Urgent Tasks (home page) ───────────────────────────────────────────────────
function setupUrgentTaskInput() {
    const input = document.getElementById('urgent-task-input');
    const btn = document.getElementById('btn-add-urgent');
    if (!input || !btn) return;
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            addUrgentTaskFromWeb();
        }
    });
}

async function loadUrgentTasks() {
    const listEl = document.getElementById('urgent-tasks-list');
    const emptyEl = document.getElementById('no-urgent-msg');
    const countEl = document.getElementById('urgent-tasks-count');
    const assignSelect = document.getElementById('urgent-assign-to');
    
    if (!listEl) return;

    if (!window.supabaseClient || !window.ORG_ID) {
        listEl.innerHTML = '';
        if (emptyEl) emptyEl.style.display = 'block';
        if (countEl) countEl.textContent = '0';
        return;
    }

    // Populate dropdown dynamically if empty/not populated
    if (assignSelect && assignSelect.options.length <= 1) { // 1 is "All staff"
        const { data: profiles } = await window.supabaseClient.from('profiles').select('employee_name, display_name').eq('org_id', window.ORG_ID);
        if (profiles && profiles.length > 0) {
            assignSelect.innerHTML = '<option value="">All staff</option>';
            profiles.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.employee_name;
                opt.textContent = p.display_name || p.employee_name;
                assignSelect.appendChild(opt);
            });
        }
    }

    const urgentBase = () =>
        window.supabaseClient
            .from('tasks')
            .select('id, text, employee_id, status, created_at')
            .eq('org_id', window.ORG_ID)
            .eq('is_urgent', true)
            .neq('status', 'completed');
    const urgentBaseMinimal = () =>
        window.supabaseClient
            .from('tasks')
            .select('id, text, employee_id, status')
            .eq('org_id', window.ORG_ID)
            .eq('is_urgent', true)
            .neq('status', 'completed');
    let { data, error } = await urgentBase().order('id', { ascending: false });
    if (error && /column|does not exist|400/i.test(supabaseErrText(error))) {
        ({ data, error } = await urgentBaseMinimal().order('id', { ascending: false }));
    }
    if (error && /column|does not exist|400/i.test(supabaseErrText(error))) {
        ({ data, error } = await urgentBaseMinimal());
    }

    if (error) {
        console.warn('[Supabase] loadUrgentTasks failed:', supabaseErrText(error));
        return;
    }

    const tasks = data || [];
    listEl.innerHTML = '';

    tasks.forEach(t => {
        const li = document.createElement('li');
        li.dataset.taskId = t.id;
        li.innerHTML = `
            <span class="urgent-task-text">${escapeHtml(t.text)}</span>
            <span class="urgent-task-meta">${(typeof window.getEmployeeNameFromId === 'function' ? window.getEmployeeNameFromId(t.employee_id) : null) || 'All'}</span>
            <button type="button" class="btn-remove-urgent" title="Mark done">
                <i class="fas fa-times"></i>
            </button>
        `;
        li.querySelector('.btn-remove-urgent').addEventListener('click', () => removeUrgentTask(t.id));
        listEl.appendChild(li);
    });

    if (emptyEl) emptyEl.style.display = tasks.length ? 'none' : 'block';
    if (countEl) countEl.textContent = tasks.length;
}

window.addUrgentTaskFromWeb = async function() {
    const input = document.getElementById('urgent-task-input');
    const assignSelect = document.getElementById('urgent-assign-to');
    if (!input || !window.supabaseClient || !window.ORG_ID) return;

    const text = (input.value || '').trim();
    if (!text) return;

    const rawName = (assignSelect?.value || '').trim() || null;
    const employeeName = rawName && typeof window.getCanonicalEmployeeName === 'function'
        ? window.getCanonicalEmployeeName(rawName) : rawName;
    const employeeId = employeeName && typeof window.getEmployeeIdFromName === 'function'
        ? window.getEmployeeIdFromName(employeeName)
        : null;

    let { error } = await window.supabaseClient
        .from('tasks')
        .insert({
            org_id: window.ORG_ID,
            text: text,
            employee_name: employeeName || null,
            employee_id: employeeId || null,
            status: 'todo',
            is_urgent: true,
        });

    // Backward compatibility: some DBs still use assigned_to instead of employee_name.
    if (error && /employee_name/i.test(error.message || '')) {
        const retry = await window.supabaseClient
            .from('tasks')
            .insert({
                org_id: window.ORG_ID,
                text: text,
                employee_id: employeeId || null,
                status: 'todo',
                is_urgent: true,
            });
        error = retry.error;
    }

    if (error) {
        console.warn('[Supabase] addUrgentTask failed:', error.message);
        if (typeof showNotificationToast === 'function') {
            showNotificationToast('Could not add urgent task.', 'error');
        }
        return;
    }

    input.value = '';
    if (assignSelect) assignSelect.value = '';
    loadUrgentTasks();
    if (typeof showNotificationToast === 'function') {
        showNotificationToast('Urgent task added!', 'success');
    }

    if (employeeName || rawName) {
        notifyTaskAssignedFromWeb(employeeName || rawName, text);
    }
};

async function notifyTaskAssignedFromWeb(employeeName, taskDescription) {
    if (!window.supabaseClient || !window.ORG_ID) return;
    await window.supabaseClient.from('notifications').insert({
        org_id: window.ORG_ID,
        employee_name: employeeName,
        type: 'task_assigned',
        title: 'New Task Assigned',
        body: taskDescription,
        read: false,
    });
    const { data } = await window.supabaseClient
        .from('push_tokens')
        .select('token')
        .eq('org_id', window.ORG_ID)
        .eq('employee_name', employeeName)
        .maybeSingle();
    if (data?.token) {
        fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: data.token,
                title: 'New Task Assigned',
                body: `You've been assigned: ${taskDescription}`,
                sound: 'default',
                data: { type: 'task_assigned' },
            }),
        }).catch((err) => console.warn('[Push] send failed:', err?.message || err));
    }
}

async function removeUrgentTask(taskId) {
    if (!taskId || !window.supabaseClient) return;
    const { error } = await window.supabaseClient
        .from('tasks')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', taskId);
    if (error) console.warn('[Supabase] removeUrgentTask failed:', error.message);
    loadUrgentTasks();
};

function webTaskRowCompleted(t) {
    const st = (t?.status || '').toString().trim().toLowerCase();
    if (['completed', 'complete', 'done', 'archived', 'cancelled'].includes(st)) return true;
    if (t?.completed_at) return true;
    return false;
}

function dashboardTaskRowCompleted(t) {
    return webTaskRowCompleted(t);
}

/** Team overview counts: skip completions from prior days; keep open tasks + anything finished today (local date). */
function dashboardTaskCountsTowardToday(t, todayStr) {
    if (!dashboardTaskRowCompleted(t)) return true;
    const ymd = (iso) => {
        if (!iso) return null;
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return null;
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const doneDay = ymd(t.completed_at) || ymd(t.created_at);
    return doneDay === todayStr;
}

function dashboardTaskAssigneeDisplayName(task) {
    const id = task?.employee_id || task?.assigned_to || null;
    const fromId = id && typeof window.getEmployeeNameFromId === 'function' ? window.getEmployeeNameFromId(id) : null;
    return (fromId || task?.employee_name || '').trim();
}

function dashboardNormName(s) {
    return (s || '').trim().toLowerCase();
}

// Team roster + task counts (all employees). "On shift today" names kept for scheduling helpers.
async function loadTodayShifts() {
    if (!window.supabaseClient || !window.ORG_ID) return;
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const [shiftsRes, positionsRes, tasksRes] = await Promise.all([
        window.supabaseClient
            .from('shifts')
            .select('id, employee_name, position, start_time')
            .eq('org_id', window.ORG_ID)
            .eq('shift_date', todayStr)
            .order('start_time', { ascending: true }),
        window.supabaseClient
            .from('employee_positions')
            .select('employee_name, position')
            .eq('org_id', window.ORG_ID)
            .order('employee_name', { ascending: true }),
        window.supabaseClient.from('tasks').select('*').eq('org_id', window.ORG_ID),
    ]);

    if (shiftsRes.error) console.warn('[Supabase] Shifts load failed:', shiftsRes.error.message);
    if (positionsRes.error) console.warn('[Supabase] employee_positions load failed:', positionsRes.error.message);
    if (tasksRes.error) console.warn('[Supabase] tasks load failed:', tasksRes.error.message);

    const shifts = shiftsRes.data || [];
    const positions = positionsRes.data || [];
    const taskRows = tasksRes.data || [];
    const taskRowsForTodaySummary = taskRows.filter((t) => dashboardTaskCountsTowardToday(t, todayStr));

    const onShiftToday = new Map();
    const todayShiftIdsByEmployee = new Map();
    shifts.forEach((s) => {
        const name = (s.employee_name || '').trim();
        if (!name) return;
        const key = dashboardNormName(name);
        if (!onShiftToday.has(key)) onShiftToday.set(key, s);
        if (!todayShiftIdsByEmployee.has(key)) todayShiftIdsByEmployee.set(key, new Set());
        if (s.id != null) todayShiftIdsByEmployee.get(key).add(String(s.id));
    });
    window.todayShiftNames = new Set(shifts.map((s) => s.employee_name).filter(Boolean));

    const positionByName = new Map();
    positions.forEach((p) => {
        const n = (p.employee_name || '').trim();
        if (n) positionByName.set(dashboardNormName(n), p.position || '');
    });

    let rosterNames = [...new Set(positions.map((p) => (p.employee_name || '').trim()).filter(Boolean))];
    if (rosterNames.length === 0) {
        const fromTasks = new Set();
        taskRows.forEach((t) => {
            const disp = dashboardTaskAssigneeDisplayName(t);
            if (disp && disp.toLowerCase() !== 'unassigned') fromTasks.add(disp);
        });
        rosterNames = [...fromTasks];
    }

    const countsByKey = new Map();
    taskRowsForTodaySummary.forEach((t) => {
        const assignee = dashboardTaskAssigneeDisplayName(t);
        if (!assignee || assignee.toLowerCase() === 'unassigned') return;
        const key = dashboardNormName(assignee);
        const taskShiftId = t?.shift_id != null ? String(t.shift_id) : null;
        const allowedShiftIds = todayShiftIdsByEmployee.get(key) || null;
        if (allowedShiftIds && allowedShiftIds.size > 0) {
            if (!taskShiftId || !allowedShiftIds.has(taskShiftId)) return;
        }
        if (!countsByKey.has(key)) countsByKey.set(key, { total: 0, done: 0 });
        const c = countsByKey.get(key);
        c.total += 1;
        if (dashboardTaskRowCompleted(t)) c.done += 1;
    });

    const shiftList = document.getElementById('shift-list');
    const badge = document.getElementById('shift-count-badge');
    const emptyMsg = document.getElementById('shift-list-empty-msg');
    if (!shiftList) return;

    shiftList.querySelectorAll('.shift-item').forEach((el) => el.remove());

    const n = rosterNames.length;
    if (emptyMsg) emptyMsg.style.display = n === 0 ? 'block' : 'none';
    if (badge) badge.textContent = n === 0 ? '0 team' : `${n} team`;

    rosterNames.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).forEach((empName) => {
        const key = dashboardNormName(empName);
        const shiftRow = onShiftToday.get(key);
        const role =
            (shiftRow && shiftRow.position) ||
            positionByName.get(key) ||
            '—';
        const counts = countsByKey.get(key) || { total: 0, done: 0 };
        const summary =
            counts.total === 0
                ? 'No tasks assigned'
                : `${counts.done} of ${counts.total} task${counts.total === 1 ? '' : 's'} finished`;
        const onShift = !!shiftRow;
        const initial = (empName || '?').charAt(0).toUpperCase();

        const item = document.createElement('div');
        item.className = 'shift-item';
        item.dataset.employeeName = empName;
        item.innerHTML = `
            <div class="employee-info">
                <div class="employee-avatar">${initial}</div>
                <div class="employee-details">
                    <span class="employee-name clickable-employee">${escapeHtml(empName)}</span>
                    <span class="employee-role">${escapeHtml(role)}${onShift ? ' · Scheduled today' : ''}</span>
                    <span class="employee-task-summary">${escapeHtml(summary)}</span>
                </div>
            </div>
            <div class="shift-status ${onShift ? 'online' : 'offline'}">
                <i class="fas fa-circle"></i>
                ${onShift ? 'On shift' : 'Off shift'}
            </div>
        `;
        const clickable = item.querySelector('.clickable-employee');
        if (clickable && typeof openEmployeeTasksModal === 'function') {
            clickable.addEventListener('click', () => openEmployeeTasksModal(empName));
        }
        shiftList.appendChild(item);
    });

    if (typeof updateEmployeeShiftCards === 'function') updateEmployeeShiftCards();
}

// ── Supabase task sync (home/dashboard page) ──────────────────────────────────
// When Supabase is ready, fetch the latest task list from the DB and re-render
// the progress list so the manager sees live status from employee mobile updates.
window.addEventListener('supabase-ready', async function () {
    if (!window.supabaseClient || !window.ORG_ID) return;

    if (typeof loadEmployeePositionsFromSupabase === 'function') {
        await loadEmployeePositionsFromSupabase();
    }

    await loadTodayShifts();

    const { data: tasks, error } = await fetchTasksForOrgOrdered();

    if (error) { console.warn('[Supabase] Dashboard task load failed:', error.message); return; }

    const nextKitchenTasks = [];
    (tasks || []).forEach(task => {
        if (webTaskRowCompleted(task)) return;
        const nameKey =
            (typeof window.getEmployeeNameFromId === 'function' ? window.getEmployeeNameFromId(task.employee_id) : null)
            || task.employee_name
            || task.assigned_to
            || null;
        const mappedName = nameKey
            ? ((typeof window.getEmployeeDisplayName === 'function'
                ? window.getEmployeeDisplayName(nameKey)
                : null) || nameKey)
            : 'Unassigned';
        const row = {
            assignee: mappedName,
            description: task.text,
            timestamp: task.created_at,
            completed: false,
            supabase_id: task.id
        };
        if (task.shift_id) row.shift_id = task.shift_id;
        nextKitchenTasks.push(row);
    });

    window.kitchenTasks = nextKitchenTasks;
    localStorage.setItem('kitchenTasks', JSON.stringify(window.kitchenTasks));
    loadStoredTasks(); // Re-render Kitchen Progress from merged kitchenTasks

    loadUrgentTasks();
    updateNavNotifBadge();
});

/**
 * True if task.assignee / employee_name matches the previous shift holder (handles "Rohan" vs "Rohan Kumar").
 */
function taskAssigneeMatchesPrevious(taskEmployeeName, previousEmployeeName) {
    const a = String(taskEmployeeName || '').trim().toLowerCase();
    const b = String(previousEmployeeName || '').trim().toLowerCase();
    if (!a || !b) return false;
    if (a === b) return true;
    const bParts = b.split(/\s+/).filter(Boolean);
    if (bParts.length && bParts.every((p) => a.includes(p))) return true;
    const aParts = a.split(/\s+/).filter(Boolean);
    if (aParts.length && aParts.every((p) => b.includes(p))) return true;
    return false;
}

/** If shiftDateYmd is set, require created_at or due_at on that calendar day (or both missing = allow). */
function taskDateMatchesShiftDay(task, shiftDateYmd) {
    if (!shiftDateYmd) return true;
    const ca = task.created_at ? String(task.created_at).slice(0, 10) : '';
    const da = task.due_at ? String(task.due_at).slice(0, 10) : '';
    if (!ca && !da) return true;
    return ca === shiftDateYmd || da === shiftDateYmd;
}

/**
 * When a shift is reassigned, move tasks linked by tasks.shift_id and legacy rows (null shift_id)
 * still assigned to the previous employee for that shift day.
 *
 * opts: { previousEmployeeName?: string, shiftDate?: string } — pass from approve-transfer after reading the shift row.
 */
window.transferTasksForShift = async function transferTasksForShift(shiftId, newEmployeeName, newEmployeeId, opts) {
    opts = opts || {};
    if (!shiftId || !window.supabaseClient || !window.ORG_ID) return { ok: true, skipped: true };
    const nameForTask =
        (typeof window.getCanonicalEmployeeName === 'function'
            ? window.getCanonicalEmployeeName(newEmployeeName)
            : null) || newEmployeeName;
    const payload = {
        employee_name: nameForTask,
        employee_id: newEmployeeId || null,
    };

    const { error } = await window.supabaseClient
        .from('tasks')
        .update(payload)
        .eq('org_id', window.ORG_ID)
        .eq('shift_id', shiftId);

    if (error) {
        const msg = error.message || '';
        if (/shift_id|column|does not exist|42703/i.test(msg)) {
            console.warn('[transferTasksForShift] shift_id batch update skipped —', msg);
        } else {
            console.warn('[transferTasksForShift] Update failed:', msg);
            return { ok: false, error: msg };
        }
    }

    const prev = (opts.previousEmployeeName || '').trim();
    const shiftDay = (opts.shiftDate || '').trim();
    if (prev) {
        const { data: legacyRows, error: legErr } = await window.supabaseClient
            .from('tasks')
            .select('id, employee_name, created_at, due_at, shift_id')
            .eq('org_id', window.ORG_ID)
            .is('shift_id', null);
        if (legErr) {
            console.warn('[transferTasksForShift] legacy task fetch failed:', legErr.message);
        } else {
            const ids = (legacyRows || [])
                .filter(
                    (t) =>
                        taskAssigneeMatchesPrevious(t.employee_name, prev) &&
                        taskDateMatchesShiftDay(t, shiftDay)
                )
                .map((t) => t.id)
                .filter(Boolean);
            if (ids.length) {
                const withShift = { ...payload, shift_id: shiftId };
                let { error: u2 } = await window.supabaseClient
                    .from('tasks')
                    .update(withShift)
                    .eq('org_id', window.ORG_ID)
                    .in('id', ids);
                if (u2 && /shift_id|column|does not exist|42703/i.test(u2.message || '')) {
                    ({ error: u2 } = await window.supabaseClient
                        .from('tasks')
                        .update(payload)
                        .eq('org_id', window.ORG_ID)
                        .in('id', ids));
                }
                if (u2) {
                    console.warn('[transferTasksForShift] legacy reassignment failed:', u2.message);
                    return { ok: false, error: u2.message || 'Legacy task update failed' };
                }
            }
        }
    }

    if (typeof window.kitchenTasks !== 'undefined' && window.kitchenTasks.length) {
        const displayName =
            (typeof window.getEmployeeDisplayName === 'function'
                ? window.getEmployeeDisplayName(newEmployeeName)
                : null) || newEmployeeName;
        let touched = false;
        window.kitchenTasks.forEach((t) => {
            const sid = t.shift_id;
            const matchesShift = sid && String(sid) === String(shiftId);
            const matchesLegacy =
                prev &&
                !sid &&
                taskAssigneeMatchesPrevious(t.assignee, prev) &&
                taskDateMatchesShiftDay({ created_at: t.timestamp, due_at: t.due_at }, shiftDay);
            if (matchesShift || matchesLegacy) {
                t.assignee = displayName;
                if (matchesLegacy) t.shift_id = shiftId;
                touched = true;
            }
        });
        if (touched) {
            try {
                localStorage.setItem('kitchenTasks', JSON.stringify(window.kitchenTasks));
            } catch (_) { /* ignore */ }
        }
    }
    return { ok: true };
};