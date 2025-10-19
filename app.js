document.addEventListener('DOMContentLoaded', function () {
    // --- API & GLOBAL STATE ---
    // Direct URL for local development. This should be changed for production.
const API_URL = 'http://localhost:5000/api';'; 
    let currentUser = null;
    let users = [];
    let inventory = [];
    let orders = [];
    let timeClockLogs = [];
    let projects = [];
    let salesReports = [];
    let userStatus = 'clocked-out'; // 'clocked-out', 'clocked-in', 'on-break'
    let liveLocationInterval = null;
    let dailyDeploymentTarget = 10; // Default target

    // --- GLOBAL VARIABLES ---
    const selfieModal = new bootstrap.Modal(document.getElementById('selfie-modal'));
    const userModal = new bootstrap.Modal(document.getElementById('userModal'));
    const inventoryModal = new bootstrap.Modal(document.getElementById('inventoryModal'));
    const orderModal = new bootstrap.Modal(document.getElementById('orderModal'));
    const projectModal = new bootstrap.Modal(document.getElementById('projectModal'));
    const assignEmployeeModal = new bootstrap.Modal(document.getElementById('assignEmployeeModal'));
    
    let selfieData = { photo: null, action: null };
    let map;
    const vehicleMarkers = {};
    const QUEZON_CITY_COORDS = [14.6760, 121.0437];

    // --- UI & NAVIGATION ---
    const navLinks = document.querySelectorAll('.nav-link');
    const pages = document.querySelectorAll('.page');
    const pageTitle = document.getElementById('page-title');
    const hamburgerMenu = document.getElementById('hamburger-menu');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay');

    navLinks.forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            const pageId = this.dataset.page;
            showPage(pageId);
            
            navLinks.forEach(l => l.classList.remove('active'));
            this.classList.add('active');

            if (window.innerWidth < 992) {
                sidebar.classList.remove('active');
                overlay.style.display = 'none';
            }
        });
    });
    
    hamburgerMenu.addEventListener('click', () => {
         sidebar.classList.toggle('active');
         overlay.style.display = sidebar.classList.contains('active') ? 'block' : 'none';
    });

    overlay.addEventListener('click', () => {
        sidebar.classList.remove('active');
        overlay.style.display = 'none';
    });

    function showPage(pageId) {
        if (!pageId) {
            document.getElementById('login-container').style.display = 'flex';
            document.getElementById('app-container').style.display = 'none';
            return;
        }
        document.getElementById('login-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'block';

        pages.forEach(page => {
            page.classList.remove('active');
        });
        const activePage = document.getElementById(pageId);
        if (activePage) {
            activePage.classList.add('active');
            pageTitle.textContent = document.querySelector(`.nav-link[data-page="${pageId}"]`).textContent.trim();
            
            // Special handling for pages that need initialization
            if (pageId === 'live-location') {
                if (!map) initMap();
                renderAllActivePins();
            }
            if (pageId === 'time-clock' && currentUser && currentUser.role === 'Employee') {
                renderEmployeeSalesReportForm();
            }
        }
    }
    
    function updateUIForRole(role) {
        document.querySelectorAll('[data-role]').forEach(item => {
            const roles = item.dataset.role.split(',');
            if (roles.includes(role)) {
                item.style.display = ''; 
            } else {
                item.style.display = 'none';
            }
        });
    }
    
    function updateDashboard() {
        document.getElementById('total-revenue').textContent = `$${orders.reduce((sum, o) => sum + o.total, 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        document.getElementById('total-orders').textContent = orders.length;
        document.getElementById('active-users').textContent = users.filter(u => u.status === 'Active').length;
        document.getElementById('low-stock-items').textContent = inventory.filter(i => i.stock < 10).length;
        renderDashboardCharts();
        renderDeploymentCharts();
        renderSellersOverview();
        renderSalesOverviewCharts();
    }

    function renderSalesOverviewCharts() {
        const dailySalesContainer = document.getElementById('daily-sales-chart-container');
        const todayStr = new Date().toISOString().split('T')[0];
        const todaysSales = orders
            .filter(order => new Date(order.date).toISOString().startsWith(todayStr))
            .reduce((sum, order) => sum + order.total, 0);

        dailySalesContainer.innerHTML = `
            <div class="static-chart h-100">
                <div class="static-chart-title">Sales for the Day</div>
                <div class="text-center d-flex flex-column justify-content-center align-items-center h-75">
                    <h2 class="display-5 fw-bold text-success">$${todaysSales.toFixed(2)}</h2>
                </div>
            </div>
        `;

        const weeklySalesContainer = document.getElementById('weekly-sales-chart-container');
        const weeklySalesData = {};
        const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const now = new Date();
        const firstDayOfWeek = new Date(now);
        firstDayOfWeek.setDate(now.getDate() - now.getDay());
        firstDayOfWeek.setHours(0, 0, 0, 0);

        dayLabels.forEach(day => weeklySalesData[day] = 0);

        const weeklyOrders = orders.filter(order => new Date(order.date) >= firstDayOfWeek);

        weeklyOrders.forEach(order => {
            const orderDay = new Date(order.date).getDay();
            const dayKey = dayLabels[orderDay];
            if (weeklySalesData.hasOwnProperty(dayKey)) {
                weeklySalesData[dayKey] += order.total;
            }
        });
        
        const maxWeeklySale = Math.max(...Object.values(weeklySalesData)) || 1;
        const weeklyChartHTML = `
            <div class="static-chart h-100">
                <div class="static-chart-title">Sales for the Week</div>
                <div class="static-bar-chart">
                    ${dayLabels.map(day => `
                        <div class="static-bar" style="height: ${ (weeklySalesData[day] / maxWeeklySale) * 100 }%;" title="$${(weeklySalesData[day] || 0).toFixed(2)}">
                            <span class="bar-label">${day}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        weeklySalesContainer.innerHTML = weeklyChartHTML;
    }


    function renderSellersOverview() {
        const today = new Date().toISOString().split('T')[0];
        const dailyList = document.getElementById('daily-sellers-list');
        const todaysLogs = timeClockLogs.filter(log => new Date(log.timestamp).toISOString().startsWith(today) && log.action === 'clock-in');
        
        const uniqueDailyUsers = {};
        todaysLogs.forEach(log => {
            if (!uniqueDailyUsers[log.userId]) {
                uniqueDailyUsers[log.userId] = {
                    name: log.userName,
                    time: new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                };
            }
        });

        if (Object.keys(uniqueDailyUsers).length === 0) {
            dailyList.innerHTML = '<li class="list-group-item text-center text-muted">No sellers have clocked in today.</li>';
        } else {
            dailyList.innerHTML = Object.values(uniqueDailyUsers).map(user => `
                <li class="list-group-item d-flex justify-content-between align-items-center">
                    ${user.name}
                    <span class="badge bg-primary rounded-pill">${user.time}</span>
                </li>
            `).join('');
        }

        const weeklyTbody = document.getElementById('weekly-sellers-table-body');
        const now = new Date();
        const firstDayOfWeek = new Date(now);
        firstDayOfWeek.setDate(now.getDate() - now.getDay()); 
        firstDayOfWeek.setHours(0, 0, 0, 0);
        
        const weeklyLogs = timeClockLogs.filter(log => new Date(log.timestamp) >= firstDayOfWeek && log.action === 'clock-in');
        
        const weeklyAttendance = {}; 
        const sellers = users.filter(u => u.role === 'Employee');

        sellers.forEach(seller => {
             weeklyAttendance[seller._id] = { name: seller.name, days: new Set() };
        });

        weeklyLogs.forEach(log => {
            const userIsSeller = sellers.some(s => s._id === log.userId);
            if (userIsSeller && weeklyAttendance[log.userId]) {
                const day = new Date(log.timestamp).toISOString().split('T')[0];
                weeklyAttendance[log.userId].days.add(day);
            }
        });
        
        if (sellers.length === 0) {
            weeklyTbody.innerHTML = '<tr><td colspan="2" class="text-center text-muted">No sellers found.</td></tr>';
        } else {
            weeklyTbody.innerHTML = sellers.map(seller => `
                <tr>
                    <td>${seller.name}</td>
                    <td><strong>${weeklyAttendance[seller._id] ? weeklyAttendance[seller._id].days.size : 0}</strong> / 7 days</td>
                </tr>
            `).join('');
        }
    }

    function renderDashboardCharts() {
        const salesContainer = document.getElementById('salesChartContainer');
        salesContainer.innerHTML = '';
        const salesData = {};
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const now = new Date();

        for (let i = 5; i >= 0; i--) {
            const d = new Date(now);
            d.setMonth(d.getMonth() - i);
            const monthKey = monthNames[d.getMonth()];
            salesData[monthKey] = 0;
        }

        orders.forEach(order => {
            const orderDate = new Date(order.date);
            if ((now.getTime() - orderDate.getTime()) < (6 * 30 * 24 * 60 * 60 * 1000)) {
                const monthKey = monthNames[orderDate.getMonth()];
                if (salesData.hasOwnProperty(monthKey)) {
                    salesData[monthKey] += order.total;
                }
            }
        });

        const maxSale = Math.max(...Object.values(salesData)) || 1;
        
        const salesChartHTML = `
            <div class="static-chart h-100">
                <div class="static-chart-title">Sales Overview (Last 6 Months)</div>
                <div class="static-bar-chart">
                    ${Object.entries(salesData).map(([month, total]) => `
                        <div class="static-bar" style="height: ${ (total / maxSale) * 100 }%;" title="$${total.toFixed(2)}">
                            <span class="bar-label">${month}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        salesContainer.innerHTML = salesChartHTML;
        
        const inventoryContainer = document.getElementById('inventoryChartContainer');
         inventoryContainer.innerHTML = '';
        const top5Items = [...inventory].sort((a,b) => b.stock - a.stock).slice(0, 5);

        const inventoryChartHTML = `
            <div class="static-chart h-100">
                <div class="static-chart-title">Top 5 Inventory Items</div>
                <ul class="static-inventory-list">
                    ${top5Items.length > 0 ? top5Items.map(item => `
                        <li>
                            <span class="item-name">${item.name}</span>
                            <span class="item-value">${item.stock}</span>
                        </li>
                    `).join('') : '<li class="text-center text-muted">No inventory data.</li>'}
                </ul>
            </div>
        `;
        inventoryContainer.innerHTML = inventoryChartHTML;

        const attendanceContainer = document.getElementById('attendanceChartContainer');
        attendanceContainer.innerHTML = '';
        const attendanceData = {};
        const dayLabels = [];
        const today = new Date();

        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const dayKey = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            dayLabels.push(dayKey);
            attendanceData[dayKey] = 0;
        }

        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(today.getDate() - 6);
        sevenDaysAgo.setHours(0, 0, 0, 0);

        const relevantLogs = timeClockLogs.filter(log => {
            const logDate = new Date(log.timestamp);
            const user = users.find(u => u._id === log.userId);
            return log.action === 'clock-in' && logDate >= sevenDaysAgo && user && user.role === 'Employee';
        });

        const dailyUniqueUsers = {};
        relevantLogs.forEach(log => {
            const dayKey = new Date(log.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            if (!dailyUniqueUsers[dayKey]) {
                dailyUniqueUsers[dayKey] = new Set();
            }
            dailyUniqueUsers[dayKey].add(log.userId);
        });

        for (const dayKey in dailyUniqueUsers) {
            if (attendanceData.hasOwnProperty(dayKey)) {
                attendanceData[dayKey] = dailyUniqueUsers[dayKey].size;
            }
        }

        const maxAttendance = Math.max(...Object.values(attendanceData)) || 1;
        const attendanceChartHTML = `
            <div class="static-chart h-100">
                <div class="static-chart-title">Daily Seller Attendance (Last 7 Days)</div>
                <div class="static-bar-chart">
                    ${dayLabels.map(day => `
                        <div class="static-bar" style="height: ${ (attendanceData[day] / maxAttendance) * 100 }%;" title="${attendanceData[day]} Seller(s)">
                            <span class="bar-label">${day}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        attendanceContainer.innerHTML = attendanceChartHTML
    }

    // --- DEPLOYMENT CHARTS ---
    function renderDeploymentCharts() {
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        
        const dailyPresent = new Set(
            timeClockLogs
                .filter(log => new Date(log.timestamp).toISOString().startsWith(todayStr) && log.action === 'clock-in')
                .map(log => log.userId)
        ).size;
        
        const dailyPercentage = dailyDeploymentTarget > 0 ? Math.min(100, (dailyPresent / dailyDeploymentTarget) * 100) : 0;
        const dailyChartContainer = document.getElementById('daily-deployment-chart');
        dailyChartContainer.innerHTML = createPieChartHTML('daily', dailyPercentage, `${dailyPresent} / ${dailyDeploymentTarget}`);

        const currentMonth = today.getMonth();
        const currentYear = today.getFullYear();
        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        const monthlyTarget = dailyDeploymentTarget * daysInMonth;

        const monthlyLogs = timeClockLogs.filter(log => {
            const logDate = new Date(log.timestamp);
            return log.action === 'clock-in' && logDate.getMonth() === currentMonth && logDate.getFullYear() === currentYear;
        });

        const monthlyDeploymentByDay = {};
        monthlyLogs.forEach(log => {
            const day = new Date(log.timestamp).toISOString().split('T')[0];
            if (!monthlyDeploymentByDay[day]) {
                monthlyDeploymentByDay[day] = new Set();
            }
            monthlyDeploymentByDay[day].add(log.userId);
        });
        
        let totalMonthlyActual = 0;
        for (const day in monthlyDeploymentByDay) {
            totalMonthlyActual += monthlyDeploymentByDay[day].size;
        }
        
        const monthlyPercentage = monthlyTarget > 0 ? Math.min(100, (totalMonthlyActual / monthlyTarget) * 100) : 0;
        const monthlyChartContainer = document.getElementById('monthly-deployment-chart');
        monthlyChartContainer.innerHTML = createPieChartHTML('monthly', monthlyPercentage, `${totalMonthlyActual} / ${monthlyTarget}`);
    }

    function createPieChartHTML(id, percentage, label) {
        const r = 20;
        const circ = 2 * Math.PI * r;
        const offset = circ - (percentage / 100) * circ;

        return `
            <div class="pie-chart-container">
                <svg viewBox="0 0 50 50" class="pie-chart-svg">
                    <circle class="pie-chart-background" cx="25" cy="25" r="${r}"></circle>
                    <circle class="pie-chart-progress" cx="25" cy="25" r="${r}"
                            style="stroke-dasharray: ${circ}; stroke-dashoffset: ${offset};">
                    </circle>
                </svg>
                <div class="pie-chart-text">
                    <div class="percentage">${Math.round(percentage)}%</div>
                    <div class="label">${label}</div>
                </div>
            </div>
        `;
    }

    // --- CRUD OPERATIONS & API CALLS ---

    async function apiCall(endpoint, method = 'GET', body = null) {
        // This is a mock API call function. It does not actually make a network request.
        console.log(`Mock API Call: ${method} ${endpoint}`);
        return new Promise(resolve => setTimeout(() => resolve(null), 200));
    }
    
    // Users
    window.editUser = function(id) {
        const user = users.find(u => u._id == id);
        document.getElementById('userId').value = user._id;
        document.getElementById('userName').value = user.name;
        document.getElementById('userEmail').value = user.email;
        document.getElementById('userRole').value = user.role;
        document.getElementById('userStatus').value = user.status;
        document.getElementById('userRate').value = user.ratePerDay || '';
        document.getElementById('userModalLabel').textContent = "Edit User";
        document.getElementById('userPassword').placeholder = "Leave blank to keep current password";
        userModal.show();
    };

    window.deleteUser = async function(id) {
        if (confirm('Are you sure you want to delete this user?')) {
            // Mock delete
            users = users.filter(u => u._id !== id);
            renderAll();
        }
    };

    function renderUserTable() {
        const tbody = document.getElementById('user-table-body');
        if (users.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center p-4">No users found. Add a user to get started.</td></tr>`;
            return;
        }
        tbody.innerHTML = users.map(user => `
            <tr>
                <td>${user.name}</td>
                <td>${user.email}</td>
                <td>${user.role}</td>
                <td><span class="badge bg-${user.status === 'Active' ? 'success' : 'secondary'}">${user.status}</span></td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" onclick="editUser('${user._id}')"><i class="bi bi-pencil-square"></i></button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteUser('${user._id}')"><i class="bi bi-trash"></i></button>
                </td>
            </tr>
        `).join('');
    }
    
    // Employee Profiles
    function renderEmployeeProfiles() {
        const container = document.getElementById('employee-profile-list');
        const employees = users.filter(u => u.role === 'Employee');
        if(employees.length === 0) {
             container.innerHTML = `<div class="col-12"><p class="text-center text-muted">No employees found.</p></div>`;
             return;
        }
        container.innerHTML = employees.map(emp => `
            <div class="col-md-6 col-lg-4">
                <div class="card profile-card">
                    <div class="card-body">
                        <div class="avatar">${emp.name.charAt(0)}</div>
                        <h5 class="card-title">${emp.name}</h5>
                        <p class="card-text text-muted">${emp.email}</p>
                        <span class="badge bg-${emp.status === 'Active' ? 'success' : 'secondary'}">${emp.status}</span>
                    </div>
                </div>
            </div>
        `).join('');
    }
    
    // Inventory
    window.editInventory = function(id) {
        const item = inventory.find(i => i._id == id);
        document.getElementById('inventoryId').value = item._id;
        document.getElementById('itemName').value = item.name;
        document.getElementById('itemCategory').value = item.category;
        document.getElementById('itemStock').value = item.stock;
        document.getElementById('itemPrice').value = item.price;
        document.getElementById('itemSupplier').value = item.supplier;
        document.getElementById('inventoryModalLabel').textContent = "Edit Item";
        inventoryModal.show();
    };

    window.deleteInventory = async function(id) {
        if (confirm('Are you sure you want to delete this item?')) {
            inventory = inventory.filter(i => i._id !== id);
            renderAll();
        }
    };

    function renderInventoryTable() {
        const tbody = document.getElementById('inventory-table-body');
        if (inventory.length === 0) {
             tbody.innerHTML = `<tr><td colspan="6" class="text-center p-4">No inventory items found.</td></tr>`;
             return;
        }
        tbody.innerHTML = inventory.map(item => `
            <tr>
                <td>${item.name}</td>
                <td>${item.category}</td>
                <td>${item.stock} ${item.stock < 10 ? '<span class="badge bg-danger ms-1">Low</span>' : ''}</td>
                <td>$${item.price.toFixed(2)}</td>
                <td>${item.supplier}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" onclick="editInventory('${item._id}')"><i class="bi bi-pencil-square"></i></button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteInventory('${item._id}')"><i class="bi bi-trash"></i></button>
                </td>
            </tr>
        `).join('');
    }
    
    // Orders
     window.editOrder = function(id) {
        const order = orders.find(o => o._id == id);
        document.getElementById('orderId').value = order._id;
        document.getElementById('orderCustomer').value = order.customer;
        document.getElementById('orderStatus').value = order.status;

        const itemsContainer = document.getElementById('orderItemsContainer');
        itemsContainer.innerHTML = '';
        order.items.forEach(item => addOrderItem(item.itemId, item.quantity));
        updateOrderTotal();

        document.getElementById('orderModalLabel').textContent = "Edit Order";
        orderModal.show();
    };

    window.deleteOrder = async function(id) {
        if (confirm('Are you sure you want to delete this order?')) {
            orders = orders.filter(o => o._id !== id);
            renderAll();
        }
    };
    
    function renderOrderTable() {
        const tbody = document.getElementById('order-table-body');
         if (orders.length === 0) {
             tbody.innerHTML = `<tr><td colspan="7" class="text-center p-4">No orders found.</td></tr>`;
             return;
        }
        tbody.innerHTML = orders.map(order => {
            const itemNames = order.items.map(item => {
                const invItem = inventory.find(i => i._id == item.itemId);
                return `${invItem ? invItem.name : 'N/A'} (x${item.quantity})`;
            }).join(', ');
            
            let statusClass = 'secondary';
            switch(order.status) {
                case 'Delivered': statusClass = 'success'; break;
                case 'Shipped': case 'Processing': statusClass = 'info'; break;
                case 'Pending': statusClass = 'warning'; break;
                case 'Cancelled': statusClass = 'danger'; break;
            }

            return `
            <tr>
                <td>${order._id.slice(-6)}</td>
                <td>${order.customer}</td>
                <td>${itemNames}</td>
                <td>$${order.total.toFixed(2)}</td>
                <td>${new Date(order.date).toLocaleDateString()}</td>
                <td><span class="badge bg-${statusClass}">${order.status}</span></td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" onclick="editOrder('${order._id}')"><i class="bi bi-pencil-square"></i></button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteOrder('${order._id}')"><i class="bi bi-trash"></i></button>
                </td>
            </tr>`
        }).join('');
    }
    
    // Sales Reports
    function renderSalesReportsTable() {
        const tbody = document.getElementById('sales-reports-table-body');
        if (salesReports.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center p-4">No sales reports submitted.</td></tr>`;
            return;
        }
        tbody.innerHTML = salesReports.map(report => {
            const user = users.find(u => u._id === report.userId);
            return `
                <tr>
                    <td>${new Date(report.date).toLocaleDateString()}</td>
                    <td>${user ? user.name : 'Unknown'}</td>
                    <td>${report.itemName || 'N/A'}</td>
                    <td>${report.beginning}</td>
                    <td>${report.remaining}</td>
                    <td>${report.sold}</td>
                </tr>
            `;
        }).reverse().join('');
    }
    
    // Projects
    window.editProject = function(id) {
        const project = projects.find(p => p._id == id);
        document.getElementById('projectId').value = project._id;
        document.getElementById('projectName').value = project.name;
        document.getElementById('projectDescription').value = project.description;
        document.getElementById('projectStartDate').value = project.startDate;
        document.getElementById('projectEndDate').value = project.endDate;
        document.getElementById('projectStatus').value = project.status;
        document.getElementById('projectModalLabel').textContent = "Edit Project";
        
        document.getElementById('projectTasks').value = project.tasks.join('\n');

        projectModal.show();
    };

    window.deleteProject = async function(id) {
        if (confirm('Are you sure you want to delete this project?')) {
            projects = projects.filter(p => p._id !== id);
            renderAll();
        }
    };

    window.assignToProject = function(id) {
        const project = projects.find(p => p._id == id);
        document.getElementById('assignProjectId').value = id;
        document.getElementById('assignProjectName').textContent = project.name;
        
        const employeeList = document.getElementById('employee-checkbox-list');
        const employees = users.filter(u => u.role === 'Employee');
        employeeList.innerHTML = employees.map(emp => `
            <div class="form-check">
                <input class="form-check-input" type="checkbox" value="${emp._id}" id="emp-${emp._id}" ${project.assignedEmployees.includes(emp._id) ? 'checked' : ''}>
                <label class="form-check-label" for="emp-${emp._id}">
                    ${emp.name}
                </label>
            </div>
        `).join('');

        assignEmployeeModal.show();
    };
    
    function renderProjectTable() {
        const tbody = document.getElementById('project-table-body');
        if (projects.length === 0) {
             tbody.innerHTML = `<tr><td colspan="6" class="text-center p-4">No projects found.</td></tr>`;
             return;
        }
        tbody.innerHTML = projects.map(project => `
            <tr>
                <td>${project.name}</td>
                <td><span class="badge bg-info">${project.status}</span></td>
                <td>${project.startDate}</td>
                <td>${project.endDate}</td>
                <td>${project.assignedEmployees.length}</td>
                <td>
                    <button class="btn btn-sm btn-outline-secondary" onclick="assignToProject('${project._id}')" title="Assign Employees"><i class="bi bi-person-plus-fill"></i></button>
                    <button class="btn btn-sm btn-outline-primary" onclick="editProject('${project._id}')" title="Edit"><i class="bi bi-pencil-square"></i></button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteProject('${project._id}')" title="Delete"><i class="bi bi-trash"></i></button>
                </td>
            </tr>
        `).join('');
    }


    // --- TIME CLOCK & LOCATION ---
    function initMap() {
         map = L.map('map').setView(QUEZON_CITY_COORDS, 13);
         L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
             attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
         }).addTo(map);
    }

    async function reverseGeocode(lat, lng) {
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
            const data = await response.json();
            return data.display_name || 'Address not found';
        } catch (error) {
            console.error("Reverse geocoding failed:", error);
            return "Could not fetch address";
        }
    }
    
    function updateLocationOnMap(user, lat, lng, logDetails) {
        if (!map) return;
        const iconUrl = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="%234f46e5" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>');
        
        const customIcon = L.icon({
            iconUrl: iconUrl,
            iconSize: [32, 32],
            iconAnchor: [16, 32],
            popupAnchor: [0, -32]
        });
        
        let popupContent = `
            <div style="min-width: 200px;">
                <h6 class="mb-1">${user.name}</h6>
                <p class="mb-2 text-muted small">${user.role}</p>
        `;

        if (logDetails) {
            // Find the original clock-in log for the day to display that time
            const todayStr = new Date(logDetails.timestamp).toISOString().split('T')[0];
            const userLogsToday = timeClockLogs.filter(log => log.userId === user._id && new Date(log.timestamp).toISOString().startsWith(todayStr));
            const clockInLog = userLogsToday.find(log => log.action === 'clock-in');

            popupContent += `
                <hr class="my-1">
                <ul class="list-unstyled mb-2 small">
                    <li><strong>Status:</strong> <span class="badge bg-${user.status === 'Active' ? 'success' : 'secondary'}">${user.status}</span></li>
                    <li><strong>Last Activity:</strong> ${logDetails.action.replace('-', ' ')} at ${new Date(logDetails.timestamp).toLocaleTimeString()}</li>
                    ${clockInLog ? `<li><strong>Clocked In:</strong> ${new Date(clockInLog.timestamp).toLocaleTimeString()}</li>` : ''}
                    <li><strong>Location:</strong> ${logDetails.address}</li>
                </ul>
                <img src="${logDetails.photo}" alt="Selfie of ${user.name}" style="width: 100%; border-radius: 5px; object-fit: cover;">
            `;
        }
        
        popupContent += `</div>`;

        if (vehicleMarkers[user._id]) {
            vehicleMarkers[user._id].setLatLng([lat, lng]);
            vehicleMarkers[user._id].setPopupContent(popupContent);
        } else {
            vehicleMarkers[user._id] = L.marker([lat, lng], {icon: customIcon}).addTo(map)
                .bindPopup(popupContent);
        }
    }
    
    function removeLocationFromMap(user) {
        if (!map) return;
        if (vehicleMarkers[user._id]) {
            map.removeLayer(vehicleMarkers[user._id]);
            delete vehicleMarkers[user._id];
        }
    }

    function renderAllActivePins() {
        if(!map) return;
        // Clear existing markers
        for (const id in vehicleMarkers) {
            map.removeLayer(vehicleMarkers[id]);
        }
        Object.keys(vehicleMarkers).forEach(key => delete vehicleMarkers[key]);

        const todayStr = new Date().toISOString().split('T')[0];
        const activeUserIds = new Set(
            timeClockLogs
            .filter(log => new Date(log.timestamp).toISOString().startsWith(todayStr))
            .map(log => log.userId)
        );

        activeUserIds.forEach(userId => {
            const user = users.find(u => u._id === userId);
            const userLogsToday = timeClockLogs.filter(log => log.userId === userId && new Date(log.timestamp).toISOString().startsWith(todayStr));
            const lastAction = userLogsToday.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

            if (user && lastAction && (lastAction.action === 'clock-in' || lastAction.action === 'break-in' || lastAction.action === 'break-out')) {
                  // Pass lastAction as the details object
                  updateLocationOnMap(user, lastAction.location.lat, lastAction.location.lng, lastAction);
            }
        });
    }
    
    function startLiveLocationSharing() {
        if (liveLocationInterval) clearInterval(liveLocationInterval);
        liveLocationInterval = setInterval(() => {
            navigator.geolocation.getCurrentPosition(position => {
                const { latitude, longitude } = position.coords;
                updateLocationOnMap(currentUser, latitude, longitude);
            }, error => console.error("Geolocation error:", error), { enableHighAccuracy: true });
        }, 5000); // Update every 5 seconds
    }

    function stopLiveLocationSharing() {
        if (liveLocationInterval) {
            clearInterval(liveLocationInterval);
            liveLocationInterval = null;
            removeLocationFromMap(currentUser);
        }
    }

    function handleClockEvent(action) {
        selfieData.action = action;
        selfieModal.show();
        startCamera();
    }

    function startCamera() {
        const video = document.getElementById('video');
        const canvas = document.getElementById('canvas');
        document.getElementById('snap').style.display = 'inline-block';
        document.getElementById('confirm-photo').style.display = 'none';
        video.style.display = 'block';
        canvas.style.display = 'none';
        navigator.mediaDevices.getUserMedia({ video: true, audio: false })
            .then(stream => {
                video.srcObject = stream;
                video.play();
            })
            .catch(err => {
                console.error("Error accessing camera:", err);
                alert("Could not access camera. Please ensure you have given permission.");
                selfieModal.hide();
            });
    }
    
    function stopCamera() {
        const video = document.getElementById('video');
        if(video.srcObject) {
            const stream = video.srcObject;
            const tracks = stream.getTracks();
            tracks.forEach(track => track.stop());
            video.srcObject = null;
        }
    }
    
    function takeSnapshot() {
        const video = document.getElementById('video');
        const canvas = document.getElementById('canvas');
        const context = canvas.getContext('2d');
        context.drawImage(video, 0, 0, 400, 300);
        selfieData.photo = canvas.toDataURL('image/png');
        
        video.style.display = 'none';
        canvas.style.display = 'block';
        document.getElementById('snap').style.display = 'none';
        document.getElementById('confirm-photo').style.display = 'inline-block';
    }

    async function processClockEvent() {
        selfieModal.hide();
        stopCamera();

        navigator.geolocation.getCurrentPosition(async position => {
            const { latitude, longitude } = position.coords;
            const address = await reverseGeocode(latitude, longitude);
            
            const logEntry = {
                _id: `log${Date.now()}`,
                userId: currentUser._id,
                userName: currentUser.name,
                action: selfieData.action,
                timestamp: new Date().toISOString(),
                photo: selfieData.photo,
                location: { lat: latitude, lng: longitude },
                address: address
            };
            
            // --- MOCK CHANGE ---
            timeClockLogs.push(logEntry);
            renderAll(); // Re-render everything to show the new log
            
            updateClockUI(selfieData.action);

            if (selfieData.action === 'clock-in') {
                updateLocationOnMap(currentUser, latitude, longitude, logEntry);
                startLiveLocationSharing();
            } else if (selfieData.action === 'clock-out') {
                stopLiveLocationSharing();
            }
            
            selfieData = { photo: null, action: null }; // Reset
        }, 
        error => {
             console.error("Geolocation failed:", error);
             alert("Could not get your location. Please enable location services.");
        }, { enableHighAccuracy: true });
    }

    function updateClockUI(lastAction) {
         const clockStatusEl = document.getElementById('clock-status');
         const clockInBtn = document.getElementById('clockInBtn');
         const clockOutBtn = document.getElementById('clockOutBtn');
         const breakInBtn = document.getElementById('breakInBtn');
         const breakOutBtn = document.getElementById('breakOutBtn');
         const reportFormContainer = document.getElementById('sales-report-form-container');
         
         switch(lastAction) {
             case 'clock-in':
                 userStatus = 'clocked-in';
                 clockStatusEl.textContent = 'You are currently clocked in.';
                 clockInBtn.disabled = true;
                 clockOutBtn.disabled = false;
                 breakInBtn.disabled = true;
                 breakOutBtn.disabled = false;
                 if(currentUser.role === 'Employee') reportFormContainer.style.display = 'block';
                 break;
             case 'clock-out':
                 userStatus = 'clocked-out';
                 clockStatusEl.textContent = 'You are currently clocked out.';
                 clockInBtn.disabled = false;
                 clockOutBtn.disabled = true;
                 breakInBtn.disabled = true;
                 breakOutBtn.disabled = true;
                 if(currentUser.role === 'Employee') reportFormContainer.style.display = 'none';
                 break;
             case 'break-out':
                 userStatus = 'on-break';
                 clockStatusEl.textContent = 'You are currently on break.';
                 clockInBtn.disabled = true;
                 clockOutBtn.disabled = true;
                 breakInBtn.disabled = false;
                 breakOutBtn.disabled = true;
                 if(currentUser.role === 'Employee') reportFormContainer.style.display = 'block';
                 break;
             case 'break-in':
                 userStatus = 'clocked-in';
                 clockStatusEl.textContent = 'You are currently clocked in.';
                 clockInBtn.disabled = true;
                 clockOutBtn.disabled = false;
                 breakInBtn.disabled = true;
                 breakOutBtn.disabled = false;
                 if(currentUser.role === 'Employee') reportFormContainer.style.display = 'block';
                 break;
         }
         renderEmployeeSalesReportForm();
    }
    
    function renderUserActivityLog() {
        const list = document.getElementById('activity-log-list');
        const userLogs = timeClockLogs.filter(log => log.userId === currentUser._id);
         if (userLogs.length === 0) {
             list.innerHTML = `<li class="list-group-item text-center text-muted">No activity logged today.</li>`;
             return;
        }
        list.innerHTML = userLogs.map(log => `
            <li class="list-group-item">
                <strong>${log.action.replace('-', ' ').replace(/\b\w/g, c => c.toUpperCase())}</strong> at ${new Date(log.timestamp).toLocaleTimeString()}
                <br><small class="text-muted">${log.address}</small>
            </li>
        `).reverse().join('');
    }
    
    function renderAdminActivityLog() {
        const tbody = document.getElementById('admin-activity-log-body');
        if (timeClockLogs.length === 0) {
             tbody.innerHTML = `<tr><td colspan="5" class="text-center p-4">No activity logs found.</td></tr>`;
             return;
        }
        tbody.innerHTML = timeClockLogs.map(log => `
            <tr>
                <td>${log.userName}</td>
                <td>${log.action.replace('-', ' ')}</td>
                <td>${new Date(log.timestamp).toLocaleString()}</td>
                <td>${log.address}</td>
                <td><a href="${log.photo}" target="_blank">View</a></td>
            </tr>
        `).reverse().join('');
    }

    // --- PAYROLL ---
    function calculatePayroll() {
        const startDate = document.getElementById('payrollStartDate').value;
        const endDate = document.getElementById('payrollEndDate').value;
        if (!startDate || !endDate) {
            alert('Please select both a start and end date.');
            return;
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999); 

        const payrollData = {};

        const employees = users.filter(u => u.role === 'Employee');
        employees.forEach(emp => {
            payrollData[emp._id] = {
                name: emp.name,
                rate: emp.ratePerDay || 0,
                daysWorked: 0
            };
        });
        
        const relevantLogs = timeClockLogs.filter(log => {
            const logDate = new Date(log.timestamp);
            return logDate >= start && logDate <= end;
        });

        employees.forEach(emp => {
            const empLogs = relevantLogs.filter(log => log.userId === emp._id);
            const workedDays = new Set();
            
            empLogs.forEach(log => {
                if (log.action === 'clock-in') {
                    const dateString = new Date(log.timestamp).toISOString().split('T')[0];
                    workedDays.add(dateString);
                }
            });

            payrollData[emp._id].daysWorked = workedDays.size;
        });
        
        renderPayrollTable(payrollData);
    }

    function renderPayrollTable(data) {
        const tbody = document.getElementById('payroll-table-body');
        const employeeIds = Object.keys(data);

        if (employeeIds.length === 0) {
             tbody.innerHTML = `<tr><td colspan="4" class="text-center p-4 text-muted">No employee data to calculate.</td></tr>`;
             return;
        }

        tbody.innerHTML = employeeIds.map(id => {
            const emp = data[id];
            const grossPay = emp.daysWorked * emp.rate;
            return `
                <tr>
                    <td>${emp.name}</td>
                    <td>$${emp.rate.toFixed(2)}</td>
                    <td>${emp.daysWorked}</td>
                    <td><strong>$${grossPay.toFixed(2)}</strong></td>
                </tr>
            `;
        }).join('');
    }
    
    // --- Sales Report ---
    function renderEmployeeSalesReportForm() {
        if (!currentUser || currentUser.role !== 'Employee') return;
        const reportForm = document.getElementById('salesReportForm');
        const todayStr = new Date().toISOString().split('T')[0];
        const existingReport = salesReports.find(r => r.userId === currentUser._id && r.date === todayStr);

        if (existingReport) {
            document.getElementById('itemNameReport').value = existingReport.itemName || '';
            document.getElementById('beginningInventory').value = existingReport.beginning;
            document.getElementById('remainingInventory').value = existingReport.remaining;
            document.getElementById('itemsSold').value = existingReport.sold;
        } else {
            reportForm.reset();
            document.getElementById('itemsSold').value = '';
        }
        
        const isClockedIn = userStatus === 'clocked-in' || userStatus === 'on-break';
        document.getElementById('itemNameReport').disabled = !isClockedIn;
        document.getElementById('beginningInventory').disabled = !isClockedIn;
        document.getElementById('remainingInventory').disabled = !isClockedIn;
        document.getElementById('submitReportBtn').disabled = !isClockedIn;
    }

    async function handleReportSubmission() {
        const itemName = document.getElementById('itemNameReport').value;
        const beginning = parseInt(document.getElementById('beginningInventory').value);
        const remaining = parseInt(document.getElementById('remainingInventory').value);

        if (!itemName.trim() || isNaN(beginning) || isNaN(remaining) || beginning < 0 || remaining < 0 || remaining > beginning) {
            alert('Please enter valid data. Remaining inventory cannot be greater than beginning.');
            return;
        }
        
        const sold = beginning - remaining;
        document.getElementById('itemsSold').value = sold;

        const todayStr = new Date().toISOString().split('T')[0];
        const existingReport = salesReports.find(r => r.userId === currentUser._id && r.date === todayStr);
        
        const reportData = {
            userId: currentUser._id,
            date: todayStr,
            itemName: itemName,
            beginning: beginning,
            remaining: remaining,
            sold: sold
        };

        if (existingReport) {
            salesReports = salesReports.map(r => r._id === existingReport._id ? {...r, ...reportData} : r);
        } else {
            reportData._id = `sr${Date.now()}`;
            salesReports.push(reportData);
        }
        
        const feedback = document.getElementById('report-feedback');
        feedback.textContent = `Report updated successfully at ${new Date().toLocaleTimeString()}.`;
        setTimeout(() => feedback.textContent = '', 3000);
        
        renderAll();
    }

    // --- EVENT LISTENERS ---
    // Login
    // Replace the mock login event listener with this:
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const loginError = document.getElementById('login-error');
    loginError.textContent = '';

    try {
        const data = await apiCall('/auth/login', 'POST', { email, password });

        if (!data || !data.user || !data.token) {
            // This will trigger if the apiCall function returns null or an invalid response
            if (!loginError.textContent) {
                loginError.textContent = "Login failed. Please check your credentials.";
            }
            return;
        }

        const { user, token } = data;

        currentUser = user;
        localStorage.setItem('authToken', token);

        document.getElementById('currentUserDisplay').innerHTML = `
            <p class="mb-1 text-white small"><b>${currentUser.name}</b></p>
            <p class="mb-2 text-white-50 small">${currentUser.role}</p>
        `;

        updateUIForRole(currentUser.role);
        await fetchAllData();

        const defaultPage = (currentUser.role === 'Employee') ? 'time-clock' : 'dashboard';
        showPage(defaultPage);
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        document.querySelector(`.nav-link[data-page="${defaultPage}"]`).classList.add('active');
    } catch (error) {
        loginError.textContent = error.message;
    }
});
    
    function handleLogout() {
        currentUser = null;
        localStorage.removeItem('authToken');
        stopLiveLocationSharing();
        showPage(null); 
        document.getElementById('login-form').reset();
        document.getElementById('login-error').textContent = '';
    }

    document.getElementById('logoutBtn').addEventListener('click', handleLogout);
    
    // User form
    document.getElementById('saveUserBtn').addEventListener('click', async () => {
        const id = document.getElementById('userId').value;
        const user = {
            name: document.getElementById('userName').value,
            email: document.getElementById('userEmail').value,
            role: document.getElementById('userRole').value,
            status: document.getElementById('userStatus').value,
            ratePerDay: parseFloat(document.getElementById('userRate').value) || 0
        };

        const password = document.getElementById('userPassword').value;
        if (password) {
            user.password = password;
        }
        
        if (id) {
            users = users.map(u => u._id === id ? {...u, ...user} : u);
        } else {
            if(!password) {
                alert('Password is required for new users.');
                return;
            }
            user._id = `user${Date.now()}`;
            users.push(user);
        }
        renderAll();
        userModal.hide();
    });
    
    // Inventory form
    document.getElementById('saveInventoryBtn').addEventListener('click', async () => {
        const id = document.getElementById('inventoryId').value;
        const item = {
            name: document.getElementById('itemName').value,
            category: document.getElementById('itemCategory').value,
            stock: parseInt(document.getElementById('itemStock').value),
            price: parseFloat(document.getElementById('itemPrice').value),
            supplier: document.getElementById('itemSupplier').value
        };

        if(id) {
            inventory = inventory.map(i => i._id === id ? {...i, ...item} : i);
        } else {
            item._id = `item${Date.now()}`;
            inventory.push(item);
        }
        renderAll();
        inventoryModal.hide();
    });
    
    // Order form
    document.getElementById('addOrderItemBtn').addEventListener('click', () => addOrderItem());
    
    function addOrderItem(selectedItemId = '', quantity = 1) {
        const container = document.getElementById('orderItemsContainer');
        const itemDiv = document.createElement('div');
        itemDiv.className = 'row g-2 mb-2 align-items-center order-item-row';
        
        const options = inventory.map(item => `<option value="${item._id}" ${item._id == selectedItemId ? 'selected' : ''}>${item.name} ($${item.price.toFixed(2)})</option>`).join('');
        
        itemDiv.innerHTML = `
            <div class="col-6">
                <select class="form-select order-item-select">${options}</select>
            </div>
            <div class="col-3">
                <input type="number" class="form-control order-item-quantity" value="${quantity}" min="1">
            </div>
            <div class="col-3">
                <button type="button" class="btn btn-sm btn-outline-danger remove-order-item-btn">Remove</button>
            </div>
        `;
        container.appendChild(itemDiv);
    }

    document.getElementById('orderItemsContainer').addEventListener('click', function(e) {
        if (e.target.classList.contains('remove-order-item-btn')) {
            e.target.closest('.order-item-row').remove();
            updateOrderTotal();
        }
    });
    document.getElementById('orderItemsContainer').addEventListener('change', updateOrderTotal);

    function updateOrderTotal() {
        let total = 0;
        document.querySelectorAll('.order-item-row').forEach(row => {
            const itemId = row.querySelector('.order-item-select').value;
            const quantity = parseInt(row.querySelector('.order-item-quantity').value);
            const item = inventory.find(i => i._id == itemId);
            if(item) {
                total += item.price * quantity;
            }
        });
        document.getElementById('orderTotal').textContent = total.toFixed(2);
    }

    document.getElementById('saveOrderBtn').addEventListener('click', async () => {
        const id = document.getElementById('orderId').value;
        const items = [];
        document.querySelectorAll('.order-item-row').forEach(row => {
            items.push({
                itemId: row.querySelector('.order-item-select').value,
                quantity: parseInt(row.querySelector('.order-item-quantity').value),
            });
        });

        const order = {
            customer: document.getElementById('orderCustomer').value,
            items: items,
            total: parseFloat(document.getElementById('orderTotal').textContent),
            date: new Date().toISOString(),
            status: document.getElementById('orderStatus').value
        };
        
        if(id) {
             orders = orders.map(o => o._id === id ? {...o, ...order} : o);
        } else {
            order._id = `order${Date.now()}`;
            orders.push(order);
        }
        renderAll();
        orderModal.hide();
    });

    // Project form
    document.getElementById('saveProjectBtn').addEventListener('click', async () => {
        const id = document.getElementById('projectId').value;
        const tasks = document.getElementById('projectTasks').value.split('\n').map(t => t.trim()).filter(Boolean);

        const project = {
            name: document.getElementById('projectName').value,
            description: document.getElementById('projectDescription').value,
            startDate: document.getElementById('projectStartDate').value,
            endDate: document.getElementById('projectEndDate').value,
            status: document.getElementById('projectStatus').value,
            tasks: tasks
        };
        
        if(id) {
            const existingProject = projects.find(p => p._id == id);
            project.assignedEmployees = existingProject.assignedEmployees;
            projects = projects.map(p => p._id === id ? {...p, ...project} : p);
        } else {
            project._id = `proj${Date.now()}`;
            project.assignedEmployees = [];
            projects.push(project);
        }
        renderAll();
        projectModal.hide();
    });

    document.getElementById('saveAssignmentBtn').addEventListener('click', async () => {
        const projectId = document.getElementById('assignProjectId').value;
        const project = projects.find(p => p._id == projectId);
        const selectedEmployees = [];
         document.querySelectorAll('#employee-checkbox-list input:checked').forEach(checkbox => {
             selectedEmployees.push(checkbox.value);
         });
        project.assignedEmployees = selectedEmployees;
        renderAll();
        assignEmployeeModal.hide();
    });
    
    // Payroll
    document.getElementById('generatePayrollBtn').addEventListener('click', calculatePayroll);

    // Deployment Target
    document.getElementById('set-deployment-target-btn').addEventListener('click', () => {
        const target = parseInt(document.getElementById('daily-deployment-target-input').value);
        if (!isNaN(target) && target >= 0) {
            dailyDeploymentTarget = target;
            updateDashboard();
        } else {
            alert('Please enter a valid number for the target.');
        }
    });

    // Sales Report
    document.getElementById('submitReportBtn').addEventListener('click', handleReportSubmission);
    document.getElementById('salesReportForm').addEventListener('input', () => {
         const beginning = parseInt(document.getElementById('beginningInventory').value) || 0;
         const remaining = parseInt(document.getElementById('remainingInventory').value) || 0;
         if (beginning >= remaining) {
             document.getElementById('itemsSold').value = beginning - remaining;
         } else {
             document.getElementById('itemsSold').value = 0;
         }
    });

    // Modal clean-up
    document.getElementById('userModal').addEventListener('hidden.bs.modal', () => {
        document.getElementById('userForm').reset();
        document.getElementById('userId').value = '';
        document.getElementById('userPassword').placeholder = "Enter new password to set/change";
        document.getElementById('userModalLabel').textContent = "Add User";
    });
    document.getElementById('inventoryModal').addEventListener('hidden.bs.modal', () => {
        document.getElementById('inventoryForm').reset();
        document.getElementById('inventoryId').value = '';
        document.getElementById('inventoryModalLabel').textContent = "Add Item";
    });
    document.getElementById('orderModal').addEventListener('hidden.bs.modal', () => {
        document.getElementById('orderForm').reset();
        document.getElementById('orderId').value = '';
        document.getElementById('orderItemsContainer').innerHTML = '';
        document.getElementById('orderTotal').textContent = '0.00';
        document.getElementById('orderModalLabel').textContent = "Create Order";
    });
     document.getElementById('projectModal').addEventListener('hidden.bs.modal', () => {
        document.getElementById('projectForm').reset();
        document.getElementById('projectId').value = '';
        document.getElementById('projectTasks').value = '';
        document.getElementById('projectModalLabel').textContent = "Add Project";
    });
    
    // Time Clock Listeners
    document.getElementById('clockInBtn').addEventListener('click', () => handleClockEvent('clock-in'));
    document.getElementById('clockOutBtn').addEventListener('click', () => handleClockEvent('clock-out'));
    document.getElementById('breakInBtn').addEventListener('click', () => handleClockEvent('break-in'));
    document.getElementById('breakOutBtn').addEventListener('click', () => handleClockEvent('break-out'));
    
    document.getElementById('snap').addEventListener('click', takeSnapshot);
    document.getElementById('confirm-photo').addEventListener('click', processClockEvent);
    document.getElementById('selfie-modal').addEventListener('hidden.bs.modal', stopCamera);
    
    // --- INITIALIZATION ---
    function loadMockData() {
        console.log("Loading mock data.");
    
        users = [
            { _id: 'mockuser123', name: 'Admin User', email: 'admin@test.com', role: 'Admin', status: 'Active', ratePerDay: 200 },
            { _id: 'user2', name: 'Manager Mike', email: 'manager@test.com', role: 'Manager', status: 'Active', ratePerDay: 150 },
            { _id: 'user3', name: 'Employee Emma', email: 'employee@test.com', role: 'Employee', status: 'Active', ratePerDay: 100 },
            { _id: 'user4', name: 'Inactive Ian', email: 'ian@test.com', role: 'Employee', status: 'Inactive', ratePerDay: 100 }
        ];
    
        inventory = [
            { _id: 'item1', name: 'Quantum Widget', category: 'Widgets', stock: 150, price: 19.99, supplier: 'Quantum Supplies' },
            { _id: 'item2', name: 'Flux Capacitor', category: 'Time Travel', stock: 5, price: 1299.99, supplier: 'Doc Brown Ent.' },
            { _id: 'item3', name: 'LED Screws', category: 'Hardware', stock: 8, price: 1.50, supplier: 'Bright Stuff Inc.' },
            { _id: 'item4', name: 'Carbon Nanotubes', category: 'Materials', stock: 500, price: 45.00, supplier: 'Future Fibers' }
        ];
    
        orders = [
            { _id: 'order1', customer: 'John Doe', items: [{ itemId: 'item1', quantity: 2 }], total: 39.98, date: new Date().toISOString(), status: 'Delivered' },
            { _id: 'order2', customer: 'Jane Smith', items: [{ itemId: 'item2', quantity: 1 }, { itemId: 'item3', quantity: 10 }], total: 1314.99, date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), status: 'Shipped' }
        ];
        
        projects = [
            { _id: 'proj1', name: 'Website Redesign', description: 'Complete overhaul of the company website.', startDate: '2025-10-01', endDate: '2025-12-15', status: 'In Progress', tasks: ['Design mockups', 'Develop frontend', 'Deploy to server'], assignedEmployees: ['user3'] },
            { _id: 'proj2', name: 'Q4 Marketing Campaign', description: 'Launch new marketing campaign for widgets.', startDate: '2025-10-15', endDate: '2025-11-30', status: 'Not Started', tasks: [], assignedEmployees: [] }
        ];
    
        const today = new Date();
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        timeClockLogs = [
            { _id: 'log1', userId: 'user3', userName: 'Employee Emma', action: 'clock-in', timestamp: yesterday.toISOString(), photo: 'https://placehold.co/100x100/EEE/31343C?text=Selfie', location: { lat: 14.6760, lng: 121.0437 }, address: 'Quezon City Hall, Quezon City' },
            { _id: 'log2', userId: 'user3', userName: 'Employee Emma', action: 'clock-out', timestamp: new Date(yesterday.getTime() + 8 * 60 * 60 * 1000).toISOString(), photo: 'https://placehold.co/100x100/EEE/31343C?text=Selfie', location: { lat: 14.6760, lng: 121.0437 }, address: 'Quezon City Hall, Quezon City' },
            { _id: 'log3', userId: 'user3', userName: 'Employee Emma', action: 'clock-in', timestamp: today.toISOString(), photo: 'https://placehold.co/100x100/EEE/31343C?text=Selfie', location: { lat: 14.6091, lng: 121.0223 }, address: 'Makati City Hall, Makati' }
        ];
    
        salesReports = [
            { _id: 'sr1', userId: 'user3', date: yesterday.toISOString().split('T')[0], itemName: 'Quantum Widget', beginning: 100, remaining: 80, sold: 20 }
        ];
    }

    async function fetchAllData() {
        // In a real app, this would fetch data from the server.
        // In this mock version, it does nothing because data is loaded in init().
        console.log("Mock environment: fetchAllData is intentionally empty.");
    }

    function renderAll() {
        if (!currentUser) return; // Don't render if not logged in
        updateDashboard();
        renderUserTable();
        renderInventoryTable();
        renderOrderTable();
        renderEmployeeProfiles();
        renderProjectTable();
        renderUserActivityLog();
        renderAdminActivityLog();
        renderSalesReportsTable();
    }

    function init() {
        // --- MOCK AUTO-LOGIN ---
        loadMockData();

        currentUser = {
            _id: 'mockuser123',
            name: 'Admin User',
            email: 'admin@test.com',
            role: 'Admin',
            status: 'Active'
        };

        document.getElementById('currentUserDisplay').innerHTML = `
            <p class="mb-1 text-white small"><b>${currentUser.name}</b></p>
            <p class="mb-2 text-white-50 small">${currentUser.role}</p>
        `;

        updateUIForRole(currentUser.role);
        renderAll();

        const defaultPage = 'dashboard';
        showPage(defaultPage);
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        document.querySelector(`.nav-link[data-page="${defaultPage}"]`).classList.add('active');
    }

    init();
});



