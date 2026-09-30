# Lumos Logic HRMS — Mobile App Master Lovable Prompt

> **Instructions for Lovable:**
> Paste this entire prompt directly into Lovable. Generate a production-ready, mobile-first Progressive Web App (PWA) / native-feeling mobile application for **Lumos Logic HRMS**.
> Do not generate a desktop website squeezed into a phone viewport. Adhere strictly to the design system, mobile UX patterns, role-based workflows, fields, and terminology defined below.

---

```markdown
# MISSION & PRODUCT OVERVIEW

You are building the official mobile application for **Lumos Logic HRMS** — an enterprise-grade Human Resource Management, Attendance, Leave, Payroll & Workforce Platform.

### Core Objective
The mobile app is designed for daily operational efficiency:
- **Employees** clock in/out, start/end breaks, view live timers, apply for leaves and WFH, submit attendance regularizations, claim expenses, access payslips, view team presence, and track onboarding/growth.
- **HR Admins** monitor real-time workforce attendance, manage employees, approve/reject pending leaves, regularizations, and expense claims, view payroll summaries, publish announcements, and track HR metrics.
- **Root Administrators** inspect organization-wide workforce health, multi-branch operations, manage HR administrators, perform multi-level approvals, monitor compliance/payroll, and broadcast push/email alerts.

Complex desktop-only functions (bulk database imports, complex salary formula configuration, biometric TCP/IP socket listeners, deep audit logs) remain on the web application. The mobile app adapts all operational workflows into intuitive, touch-friendly mobile screens.

---

# DESIGN SYSTEM: "EXECUTIVE PRECISION"

Adhere strictly to this design tokens specification across all screens and components:

### 1. Color Palette
- **Primary / Brand:** `#3525cd` (Deep Royal Indigo)
- **Primary Container / Hover / Active:** `#4f46e5` (Vibrant Indigo)
- **Secondary / Accent:** `#712ae2` (Deep Purple)
- **Secondary Container:** `#8a4cfc` (Light Purple)
- **Background:** `#f9f9ff` (Soft clean off-white canvas)
- **Surface / Card Background:** `#ffffff` (Pure White)
- **Surface Container Low:** `#f0f3ff` (Ultra-light tint for chips, subtle borders, input backgrounds)
- **Surface Container Medium:** `#e7eefe` (Divider lines, subtle card borders)
- **Text Primary (On-Surface):** `#151c27` (Near-black, high contrast)
- **Text Secondary (On-Surface Variant):** `#464555` (Slate Grey)
- **Text Muted / Placeholder / Icons:** `#777587` (Muted Neutral)
- **Border / Outline:** `#c7c4d8` (Clean subtle outline)
- **Success / Present:** `#10b981` (Emerald) | Background: `#ecfdf5` | Border: `#a7f3d0` | Text: `#065f46`
- **Warning / Pending / Half Day:** `#f59e0b` (Amber) | Background: `#fffbeb` | Border: `#fde68a` | Text: `#92400e`
- **Danger / Absent / Rejected:** `#ef4444` (Rose/Red) | Background: `#fef2f2` | Border: `#fecaca` | Text: `#991b1b`
- **Info / WFH:** `#06b6d4` (Cyan) | Background: `#ecfeff` | Border: `#a5f3fc` | Text: `#155e75`

### 2. Typography
- **Font Family:** `Inter`, -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif.
- **Heading 1 (Screen Titles):** `text-xl font-black text-[#151c27] tracking-tight` (20px, bold 800)
- **Heading 2 (Card / Section Headers):** `text-base font-extrabold text-[#151c27]` (16px, bold 700)
- **Heading 3 (Sub-sections / Modal Titles):** `text-sm font-bold text-[#151c27]` (14px, bold 700)
- **Body Regular:** `text-sm font-normal text-[#464555] leading-relaxed` (14px, regular 400)
- **Body Medium / Values:** `text-sm font-semibold text-[#151c27]` (14px, medium 600)
- **Section Eyebrow / Form Labels:** `text-[0.68rem] font-black uppercase tracking-[0.14em] text-[#777587]` (11px, bold 800)
- **Caption / Metadata:** `text-xs text-[#777587]` (12px, regular 400)

### 3. Elevation & Shadows
- **Card Shadow:** `box-shadow: 0 4px 14px rgba(0, 0, 0, 0.04);`
- **Elevated / Bottom Sheet Shadow:** `box-shadow: 0 -8px 24px rgba(21, 28, 39, 0.12);`
- **Floating Action / Button Shadow:** `box-shadow: 0 4px 12px rgba(53, 37, 205, 0.25);`

### 4. Borders & Corner Radii
- **Cards & Sheets:** `rounded-2xl` (16px)
- **Buttons & Inputs:** `rounded-xl` (12px)
- **Pills / Status Badges:** `rounded-full` (9999px)
- **Border Width:** `1px solid #c7c4d8` or `#e7eefe`

---

# MOBILE UX & LAYOUT PRINCIPLES

1. **Touch-First Ergonomics:** Minimum interactive touch target of 44x44px. Critical primary actions (Check In/Out, Submit, Approve) placed in the lower half of the screen or in a sticky bottom bar.
2. **Safe Area Insets:** Strict support for iOS Notch (`env(safe-area-inset-top)`) and Home Indicator (`env(safe-area-inset-bottom)`).
3. **No Horizontal Scroll Tables:** Desktop data tables are converted into stacked list cards with high-priority metrics visible upfront and tapping opening a detail screen or bottom sheet.
4. **Bottom Sheets Over Centered Modals:** Use smooth slide-up bottom sheets with drag handles for creation forms, filters, and action sheets.
5. **Clear Visual Hierarchy:** Primary actions in solid `#3525cd` with white text. Destructive actions in Rose `#ef4444`. Secondary actions in outlined white buttons with `#c7c4d8` borders.
6. **Instant State Feedback:**
   - Skeleton loading blocks with shimmering animation.
   - Empty states with dedicated icons, descriptive text, and a primary CTA.
   - Micro-toasts for success and error messages floating at the top of the viewport.

---

# ROLE ARCHITECTURE & AUTHENTICATION FLOW

The app supports 3 distinct roles:
1. **Employee (`employee`)** — Self-service portal for attendance, leaves, regularizations, expenses, payslips, profile, and team calendar. If the employee is also a Department Head (`is_dept_head: true`), an additional "Team Approvals" module appears.
2. **HR Admin (`admin`)** — Operational workforce management, leave/attendance/expense approvals, employee directory, shift rosters, and payroll tracking.
3. **Root Admin (`root_admin`)** — Complete organization governance, HR admin management, multi-branch switcher, department management, multi-level final approvals, and broadcast communications.

### Authentication Screens
1. **Login Screen (`/login`):**
   - Brand logo and header: "Lumos Logic HRMS".
   - Form fields: Work Email (`type="email"`), Password (`type="password"` with show/hide toggle).
   - "Remember me" checkbox and "Forgot Password?" link.
   - Primary button: "Sign In" (shows spinner when loading).
   - **2FA TOTP Step:** If `requires2FA: true` is returned, smoothly transition to a 6-digit TOTP code input with a numeric keypad, timer countdown, and "Verify & Proceed" button.
   - Auto-routing upon login:
     - `employee` → `/portal/home`
     - `admin` → `/dashboard`
     - `root_admin` → `/root/branch-select` (or `/root/dashboard` if single branch)
2. **Forgot Password Screen (`/forgot-password`):**
   - Email address input with instant validation.
   - "Send Reset Link" button.
   - Success state showing "Check your email" with 1-hour expiry notice and "Back to Login" link.
3. **Branch Selection Screen (`/root/branch-select` for Multi-branch Root Admins):**
   - List of organization branches with active employee counts.
   - Option to select "All Branches (Global View)" or a specific physical branch.

---

# MOBILE NAVIGATION ARCHITECTURE

Do not crowd the bottom navigation bar. Use a fixed 4-tab bottom navigation with a structured "More" hub.

### 1. Employee Mobile Navigation
- **Tab 1: Home** (`/portal/home`) — Live greeting, today's attendance timer, Check In/Out/Break widget, leave balances, quick actions, pending actions, culture alerts.
- **Tab 2: Attendance** (`/portal/attendance`) — Today's timeline, monthly calendar/history cards, hours worked, punch details, regularization request shortcut.
- **Tab 3: Leaves** (`/portal/leaves`) — Leave quota balances, Apply Leave / WFH action, pending & past leave request cards, timeline drawer.
- **Tab 4: More** (`/portal/more`) — Organized categorized hub:
  - *My Workspace:* Team Calendar, Regularization Requests.
  - *Finance & Docs:* My Payslips, My Expenses, My Documents.
  - *Company & Growth:* Goals & Performance, Onboarding Checklist, Announcements, Notifications (with unread badge), Resignation / Exit.
  - *Team Leadership (Conditional if Dept Head):* Team Approvals (with pending badge).
  - *Account:* My Profile, Change Password, Sign Out.

### 2. HR Admin Mobile Navigation
- **Tab 1: Dashboard** (`/dashboard`) — Workforce KPI cards (Present, On Leave, WFH, Absent), personal attendance widget, pending approvals counter, today's leave roster.
- **Tab 2: Employees** (`/employees`) — Searchable directory, filter by department/branch/status, employee profile detail card, quick contact triggers.
- **Tab 3: Approvals** (`/pending-approvals`) — Unified approval hub with segment pills (Leaves, WFH, Regularizations, Expenses) and 1-tap Approve/Reject.
- **Tab 4: More** (`/more`) — Organized categorized hub:
  - *Workforce Operations:* Departments, Branches, Shifts & Rosters, Holidays, Onboarding Management, Exit Management.
  - *Attendance & Biometric:* Calendar Overview, Punch Logs, Biometric Device Status.
  - *Finance:* Payroll Generation Overview, Payslip Distribution, Compliance Tracker.
  - *Communication:* Announcements Manager, Notification Center.
  - *Account:* My Profile, HR Settings, Sign Out.

### 3. Root Admin Mobile Navigation
- **Tab 1: Overview** (`/root/dashboard`) — Executive KPI summary (Total Workforce, HR Admins, Attendance Rate, Branches, Alerts), workforce distribution doughnut.
- **Tab 2: Workforce** (`/root/employees`) — Organization-wide employee search, branch filter, add employee shortcut, profile inspect.
- **Tab 3: Approvals** (`/root/pending-approvals`) — Multi-level approval queue (Leaves, Regularizations, Expenses, Resignations).
- **Tab 4: More** (`/root/more`) — Executive governance hub:
  - *Governance:* Manage HR Admins, Role Management & Permission Matrix, Manage Root Admins.
  - *Organization:* Departments, Branches Switcher, Holidays, Leave Policies, Shift Rosters.
  - *Finance & Statutory:* Payroll Dashboard, Statutory & Compliance Overview, Expense Audits.
  - *Communication:* Emergency Broadcast (Push & Email), Announcements.
  - *Account:* Root Profile, Organization Settings, Sign Out.

---

# COMPREHENSIVE SCREEN-BY-SCREEN SPECIFICATIONS

---

## 1. EMPLOYEE SCREENS

### Screen 1.1: Employee Home / Dashboard (`/portal/home`)
- **Top App Header:**
  - Organization Logo (`/LogoWithoutName.svg`) and "Lumos Logic".
  - Right Icons: Global Search trigger (magnifying glass) and Notification Bell with red unread count badge.
- **Hero Card (Executive Purple Gradient):**
  - Background: `linear-gradient(135deg, #1e1b8e 0%, #3525cd 55%, #4f46e5 100%)` with subtle radial glow.
  - Greeting text: "Good Morning / Afternoon, {First Name}! 👋"
  - Subtitle: "Have a productive day ahead."
  - **4 Stat Mini-Chips (Translucent White Containers):**
    1. *Checked In:* Displays clock-in time (e.g. "09:15 AM") or "Not Checked In".
    2. *Working Time:* Live running elapsed timer (e.g. "4h 25m"), pauses automatically if on break.
    3. *Remaining:* Time left based on 8h target (e.g. "3h 35m") or "Day Done".
    4. *Today's Shift:* Displays shift name & hours (e.g. "General · 9:00 AM – 6:00 PM").
  - **Primary Action Buttons Bar:**
    - If Not Checked In: Full-width vibrant White button with `#3525cd` text: `[LogIn Icon] Check In Now`.
    - If Checked In (Active): Two-button flex row:
      - Left (Outline White): `[Coffee Icon] Take Break`
      - Right (Solid White): `[LogOut Icon] Check Out`
    - If On Break: Solid Amber button: `[Play Icon] End Break ({Elapsed} on break)`.
    - If Checked Out: Translucent disabled pill: `[CheckCircle Icon] Day Completed ({Total Hours})`.
  - Secondary Row: Outlined White buttons for `+ Apply Leave` and `⏱ Regularize`.
- **Pending Actions Banner (Conditional):**
  - If user has pending regularizations, leave requests, or expense claims, render an amber warning card:
  - "Pending Actions: {X} leave requests, {Y} regularizations waiting for approval." Tapping navigates to respective screen.
- **Weekly Attendance Bar Chart Card:**
  - 7 vertical day bars (Mon–Sun) showing hours worked.
  - Color coded: Green (`≥ 8h`), Amber (`6–8h`), Red (`< 6h`), Light Blue (`Weekend/Holiday`).
  - Attendance % and Average Hours Worked KPI chips below chart.
- **Leave Balances Grid:**
  - Horizontal scrollable or 2-column compact cards for each leave policy:
    - Casual Leave (🌂 Amber)
    - Sick Leave (🤒 Rose)
    - Annual / Earned Leave (🏖️ Indigo)
    - Work From Home (🏠 Cyan)
  - Card displays: Available Balance, Used Days, Total Annual Quota, and a progress bar.
- **Quick Action Grid (2x4 Touch Cards):**
  - Apply Leave (Umbrella icon, `#f0f3ff`)
  - Attendance Correction (ClipboardList icon, Amber)
  - Expense Claim (CreditCard icon, Emerald)
  - Download Payslip (Download icon, Rose)
  - My Documents (FolderOpen icon, Purple)
  - Attendance History (CalendarDays icon, Cyan)
  - My Profile (User icon, Pink)
  - Goals & Tasks (Target icon, Orange)
- **Team Presence Donut Card:**
  - Visual circle breakdown: In Office vs. WFH vs. On Leave.
  - Horizontal list of teammates on leave/WFH today with avatar and status tag.
- **Company Culture & Announcements:**
  - Upcoming holidays carousel with days countdown.
  - Today's and upcoming colleague birthdays with "Wish" button.
  - Latest pinned company announcements.

---

### Screen 1.2: My Attendance (`/portal/attendance`)
- **Top Header:** Title "My Attendance", Month-Year picker trigger (e.g. "October 2026 ▾"), and CSV Export button.
- **Today's Status Card:**
  - Check-in time, check-out time, break duration, gross hours, and effective working hours.
- **Monthly Summary KPI Strip (4 compact cards):**
  - Present Days (Emerald)
  - Late / Early Exit Days (Orange)
  - Leaves / WFH (Indigo/Cyan)
  - Absent Days (Rose)
- **Attendance History List (Daily Cards):**
  - Each item card shows:
    - Left: Day number (e.g. "24") and weekday abbreviation ("Thu").
    - Center: Status Badge (`Present`, `Half Day`, `WFH`, `On Leave`, `Absent`, `Holiday`, `Weekly Off`).
    - Subtext: In: `09:12 AM` · Out: `06:18 PM` · Work: `8h 24m` (Break: `42m`).
    - Biometric Punches Trigger: If biometric is active, tapping expands punch logs (`09:12 In`, `13:05 Out`, `13:45 In`, `18:18 Out`).
    - Right Action: If status is Absent, Half Day, or Missed Punch, display `[Fix]` button opening Regularization with date pre-selected.
- **Filter Sheet:** Filter by status (All, Present, Late, Half Day, Leave, Absent).

---

### Screen 1.3: My Leaves & WFH (`/portal/leaves`)
- **Top Header:** Title "My Leaves", and prominent `+ Apply` button.
- **Leave Balance Carousel / Compact Cards:**
  - Available quota chips with remaining days highlighted.
- **Segmented Filter Control:** `All Requests` | `Pending` | `Approved` | `History`.
- **Request Cards List:**
  - Card displays:
    - Leave Type Badge (e.g. "Casual Leave" or "Work From Home").
    - Date range: "12 Nov 2026 – 14 Nov 2026 (3 Days · Full Day)".
    - Status Badge:
      - `Pending` (Amber)
      - `Pending Dept. Approval` (Blue)
      - `Pending Final Approval` (Violet)
      - `Approved` (Emerald)
      - `Rejected` (Rose)
      - `Cancelled` (Slate)
    - Reason snippet: "Attending family function in hometown."
    - Tapping card opens the **Leave Timeline Bottom Sheet**.
- **Action Triggers:**
  - If status is `Pending`, show `Cancel Request` button (with confirmation dialog).

---

### Screen 1.4: Apply Leave / WFH Bottom Sheet
- **Modal Header:** "Apply for Leave or WFH" with close (X) button.
- **Segmented Control:** `Take Leave` | `Work From Home (WFH)`.
- **Form Fields (Leave Mode):**
  1. *Leave Type:* Searchable dropdown populated with active policies (Annual, Casual, Sick, Emergency, Maternity, Paternity, Comp Off, Unpaid). Shows remaining balance inline next to each type.
  2. *Duration Type:* Segmented control: `Full Day` | `Half Day`.
  3. *If Half Day:* Selector: `First Half` (Morning) | `Second Half` (Afternoon).
  4. *Start Date:* Native Date Picker (default: today).
  5. *End Date:* Native Date Picker (auto-matches Start Date).
  6. *Working Days Counter:* Real-time calculated label: e.g. "Total: 2.0 working days (excluding weekends & holidays)".
  7. *Conflict Warning:* Real-time banner if overlapping with an existing leave or marked attendance.
  8. *Reason:* Multiline textarea (required, min 5 chars).
- **Form Fields (WFH Mode):**
  1. *WFH Date:* Native Date Picker.
  2. *Work Location:* Text field (e.g. "Home, Indiranagar, Bangalore").
  3. *Emergency Contact Number:* Tel input (10-digit validation).
  4. *Reason:* Multiline textarea.
- **Sticky Bottom Action:** Full-width Primary Button: `Submit Request`.

---

### Screen 1.5: Regularization & Early Leave (`/portal/regularization`)
- **Top Header:** Title "Attendance Correction", and `+ Request` button.
- **Information Box:** "Forgot to check in or out? Left early? Submit a regularization request with valid reason for HR review."
- **Requests List:**
  - Date of correction requested.
  - Correction Type Tag: `Attendance Correction` (Blue) or `Early Leave` (Amber).
  - Original System Time vs. Requested In/Out Time.
  - Reviewer Status (`Pending`, `Approved`, `Rejected`).
  - Reviewer Notes (if rejected/approved with comments).
- **Apply Regularization Form Sheet:**
  - Correction Type: `Clock-In/Out Correction` vs. `Early Leave Approval`.
  - Date selector.
  - System Recorded In/Out (read-only reference).
  - Requested Check-In Time (Time picker).
  - Requested Check-Out Time (Time picker).
  - If Early Leave: Requested Exit Time (Time picker).
  - Reason (required textarea).
  - Submit button.

---

### Screen 1.6: My Payslips (`/portal/payslips`)
- **Top Header:** Title "My Payslips".
- **Year Selector:** Pill selector for financial year (e.g. "2026", "2025").
- **Payslip Cards List:**
  - Card Header: Month & Year (e.g. "September 2026").
  - Net Pay (Large bold Indigo: e.g. `₹74,500`).
  - Status Badge: `Published` (Emerald) or `Draft` (Amber).
  - Quick Action: `[Download PDF]` button (triggers native download).
  - Tapping card expands or navigates to **Payslip Detail Breakdown**:
    - **Gross Earnings:** Basic, HRA, DA, Transport Allowance, Medical Allowance, Special Allowance.
    - **Deductions:** Provident Fund (PF Employee), ESI Employee, Professional Tax (PT), TDS / Income Tax, Retention, Loss of Pay (LOP) deduction with days counted.
    - **Employer Contributions:** PF Employer, ESI Employer, Total CTC.
    - **Attendance Summary:** Working Days, Days Worked, Paid Leaves, LOP Days.

---

### Screen 1.7: My Expenses (`/portal/expenses`)
- **Top Header:** Title "Expense Claims", `+ New Claim` button.
- **Summary Strip:** Total Claimed (₹), Approved (₹), Pending (₹).
- **Claims List:**
  - Card displays: Category icon & label (✈️ Travel, 🍽️ Meals, 🏨 Stay, ⛽ Fuel, 🌐 Internet, etc.).
  - Title & Date: e.g. "Client Lunch with ACME Corp · 18 Sep 2026".
  - Amount: Bold formatted currency (e.g. `₹2,450.00`).
  - Status: `Pending` | `Manager Approved` | `Approved` | `Rejected`.
  - Receipt thumbnail indicator (tap to view full image/PDF).
- **Submit Expense Claim Bottom Sheet:**
  - Title (required, max 80 chars).
  - Category selector.
  - Amount in ₹ (numeric input with 2 decimals).
  - Expense Date.
  - Merchant / Vendor Name.
  - Invoice / Receipt Number.
  - Receipt Upload: Drag/Tap file upload (Camera or Gallery / PDF, max 5 MB).
  - Duplicate check alert (alerts if matching invoice number already exists).
  - Submit button.

---

### Screen 1.8: My Documents (`/portal/documents`)
- **Top Header:** Title "My Documents", `+ Upload` button.
- **Tabs:** `My Personal Documents` | `Company Policies & Handbooks`.
- **Personal Documents List:**
  - Categorized items: Aadhaar Card, PAN Card, Bank Account Proof / Cancelled Cheque, Passport Photo, Educational Degree/Marksheets, Experience/Relieving Letters.
  - Card shows document name, uploaded date, file size, format tag (PDF/PNG).
  - Verification Status: `Under Review` (Amber), `HR Approved` (Yellow), `Approved` (Emerald), `Rejected` (Rose), `Re-upload Requested` (Orange).
  - If Re-upload Requested: prominent banner with HR's rejection reason and `Re-upload Now` action.
  - Actions per doc: View/Preview, Download.
- **Upload Document Sheet:**
  - Document Category dropdown.
  - Document Name.
  - File picker (Camera, Gallery, File Explorer).
  - Expiry Date (optional, for Passports/Visas).
  - Submit button.

---

### Screen 1.9: My Profile (`/portal/profile`)
- **Header:** Large circular avatar with initials or uploaded photo, name, employee code, designation, department, and work location.
- **Tabbed Sections / Stacked Accordions:**
  1. *Personal Info:* Full Name, Salutation, Date of Birth, Gender, Blood Group, Marital Status, Nationality.
  2. *Contact & Address:* Work Email, Personal Email, Mobile Number, Current Residential Address, Permanent Address.
  3. *Employment Details:* Employee ID, Joining Date, Employment Type (Full Time), Work Mode (Office/Hybrid), Department, Branch, Direct Manager, Probation Status.
  4. *Bank & Statutory Details:* Bank Name, Account Number (masked: `****4921`), IFSC Code, PAN Number (masked), UAN / PF Number.
  5. *Emergency Contacts:* Primary contact name, relationship, phone number.
  6. *Account Security:* Change Password form, Two-Factor Authentication (2FA) status toggle, Session logout.

---

### Screen 1.10: Team Approvals (Department Head Portal) (`/portal/dept-approvals`)
*(Only visible if current user has `is_dept_head: true`)*
- **Header:** "Team Approvals" with badge of pending team requests.
- **Pending Leave / WFH Requests List:**
  - Team member avatar, name, department, and role.
  - Leave Type & Duration (e.g. "Sick Leave · 2 Days · Oct 14–15").
  - Reason statement.
  - Department calendar conflict preview ("1 other member on leave that day").
- **Actions:**
  - `Reject`: Opens remarks sheet (optional rejection reason) and rejects request.
  - `Approve & Forward`: If multi-stage workflow, forwards to Root Admin. If single-stage, grants immediate final approval.

---

## 2. HR ADMIN SCREENS

### Screen 2.1: HR Dashboard (`/dashboard`)
- **Top Header:** Organization name, HR Admin Console badge, Branch selector dropdown, Notification bell.
- **Workforce KPI Cards (Horizontal Swiper / 2x2 Grid):**
  1. *Total Employees:* Total active headcount.
  2. *Present Today:* Count and % of workforce present.
  3. *On Leave Today:* Count and % on approved leave.
  4. *WFH Today:* Count working remotely.
  5. *Absent / Unmarked:* Count of absent staff.
- **Personal HR Check-in Widget:** Compact version of Employee check-in/out so HR can log their own work hours directly from the dashboard.
- **Today's Attendance Doughnut Chart:** Clean interactive segmented ring (Present, WFH, On Leave, Absent).
- **Pending Approvals Quick Action Cards:**
  - Summary row showing: `{X} Leaves` | `{Y} Regularizations` | `{Z} Expenses`. Tapping opens the Approvals hub.
- **Who Is Out Today List:**
  - Expandable avatars and names of all employees on leave or WFH today with leave type tags.
- **Culture & People Corner:**
  - Today's employee birthdays with quick "Send Wishes" button.
  - Work anniversaries.
  - Upcoming holidays.

---

### Screen 2.2: Employees Management (`/employees`)
- **Top Header:** Title "Employees", Add Employee (+) button.
- **Search & Filter Bar:**
  - Instant search input (by Name, Employee Code, Email).
  - Filter pills: Department, Branch, Employment Status (`Active`, `On Leave`, `Inactive`).
- **Employee Cards List:**
  - Card displays:
    - Avatar with online/present status dot.
    - Full Name and Employee Code (e.g. "EMP-042").
    - Position / Designation & Department.
    - Branch and Work Mode tag (`Office`, `Hybrid`, `Remote`).
    - Quick touch buttons: Call (tel:), Email (mailto:), View Full Profile.
- **Employee Profile Bottom Sheet / Detail Screen:**
  - Comprehensive tabs matching web:
    - *Overview:* Key stats, attendance percentage, tenure.
    - *Personal & Contact:* Personal email, mobile, address, emergency contact.
    - *Job & Compensation:* CTC, Designation, Grade, Branch, Joining date.
    - *Documents:* Uploaded KYC documents with verify/approve buttons.
    - *Work & Shift:* Assigned shift roster, biometric device PIN mapping.
    - *Actions:* Edit Employee, Change Password, Resend Credentials, Deactivate/Terminate.
- **Add / Edit Employee Bottom Sheet Form:**
  - Single-column scrollable form divided into collapsible sections:
    - *Section 1: Basic Info:* First Name*, Middle Name, Surname, Work Email*, Phone*, Password (or Auto-generate & Email).
    - *Section 2: Job Assignment:* Department (single/multi-select)*, Position/Title*, Designation, Branch*, Joining Date*, Employment Type, Work Mode.
    - *Section 3: Compensation & Biometric:* Annual CTC (₹), Biometric Device PIN / Enrollment ID, Work Hours Per Day (default 8).
    - *Section 4: Address & Personal:* Date of Birth, Gender, Current Address.
  - Sticky Bottom Bar: `Save Employee`.

---

### Screen 2.3: Pending Approvals Hub (`/pending-approvals`)
- **Top Header:** Title "Pending Approvals".
- **Module Segment Tabs:** `All` | `Leaves ({Count})` | `Regularizations ({Count})` | `Expenses ({Count})`.
- **Card-Based Approval List:**
  - **For Leave Requests:**
    - Requester avatar, name, department.
    - Leave type pill, date range, day count.
    - Reason for leave.
    - Bottom buttons: `[Reject]` (Red outline) and `[Approve]` (Emerald solid).
  - **For Regularization Requests:**
    - Requester name, date of punch.
    - Correction Type (`Attendance Correction` vs `Early Leave`).
    - Original Recorded Time vs. Requested Time.
    - Employee reason.
    - `[Reject]` (opens note dialog) and `[Approve]` button.
  - **For Expense Claims:**
    - Requester name, category icon, claim title.
    - Amount in bold (₹).
    - Date and vendor name.
    - Thumbnail of receipt (tap opens full-screen **Receipt Viewer**).
    - `[Reject]` and `[Approve]` button.

---

### Screen 2.4: Shifts & Roster (`/shifts`)
- **Top Header:** Title "Shifts & Roster", `+ New Shift` button.
- **Shift Template Cards:**
  - Shift Name: e.g. "General Shift", "Morning Shift", "Night Shift".
  - Time Range: e.g. "09:00 AM – 06:00 PM (9 hrs)".
  - Active Work Days: Mon, Tue, Wed, Thu, Fri (highlighted badges).
  - Assigned Employees count.
  - Action: Edit, Delete, Assign Employees.
- **Create / Edit Shift Sheet:**
  - Shift Name*.
  - Start Time & End Time (with overnight shift support).
  - Days of week checkboxes.
  - Shift color picker.

---

### Screen 2.5: Announcements Manager (`/announcements`)
- **Top Header:** Title "Announcements", `+ Post` button.
- **Announcements Feed:**
  - Announcement cards with Type Icon & Color:
    - `General` (Indigo)
    - `Urgent` (Rose)
    - `Policy` (Amber)
    - `Celebration` (Emerald)
  - Pinned banner indicator (📌 Pinned).
  - Title and formatted body text.
  - Attached image or PDF preview.
  - Target Audience: "All Employees" or specific department.
  - Posted by and timestamp.
  - Actions: Edit, Pin/Unpin, Delete.
- **Post Announcement Sheet:**
  - Title* (max 100 chars with live counter).
  - Content* (max 2000 chars).
  - Category selector.
  - Pin to Top toggle (max 3 pinned).
  - Attachment upload (poster image or PDF document).
  - Target audience selector.
  - Post button.

---

## 3. ROOT ADMIN SCREENS

### Screen 3.1: Root Executive Dashboard (`/root/dashboard`)
- **Top Header:** Organization Name, "Root Admin Console", Branch Switcher trigger, Profile avatar.
- **Organization Health KPI Grid (6 Metric Cards):**
  1. *Total Workforce:* Active headcount org-wide.
  2. *HR Administrators:* Active HR admin count.
  3. *Today's Present Rate:* % of workforce checked in.
  4. *Total Approvals Pending:* Sum of pending leaves, regularizations, and claims.
  5. *Active Departments:* Department count.
  6. *Active Branches:* Branch locations count.
- **Workforce Distribution Visualizer:** Doughnut chart representing Present, WFH, On Leave, Half Day, Absent across the entire enterprise.
- **Branch Performance Breakdown:** Horizontal swipe cards comparing attendance percentage per branch location.
- **Executive Pending Approvals Queue:** Quick review list for multi-level final approvals.
- **Quick Admin Shortcuts Grid:**
  - Add Employee
  - Manage HR Admins
  - Add Department
  - Manage Shifts
  - Emergency Broadcast
  - Payroll Summary
  - Organization Settings

---

### Screen 3.2: Manage HR Administrators (`/root/manage-hr`)
- **Top Header:** Title "HR Administrators", `+ Add HR` button.
- **HR Admin Cards List:**
  - Admin Avatar, Name, Email, Phone.
  - Department & Assigned Branch (or "All Branches").
  - Status Badge (`Active`, `Inactive`).
  - Actions: Edit Details, Reassign Branch, Reset Password, Remove Admin.
- **Add HR Admin Sheet:**
  - Full Name*, Official Email*, Password*.
  - Department (Human Resources), Position (HR Manager).
  - Branch Assignment dropdown.
  - Avatar color picker.

---

### Screen 3.3: Emergency Broadcast (`/root/broadcast`)
- **Top Header:** Title "Broadcast Alert".
- **Segmented Control:** `Push Notification` | `Email Broadcast`.
- **Push Notification Form:**
  - Target Audience: `All Employees` | `Specific Department` | `Specific Employee`.
  - Notification Title* (max 100 chars).
  - Notification Message Body* (max 1000 chars).
  - Target URL / Deep link (optional, default `/`).
  - Live preview phone mockup showing how the push alert appears on lock screen.
  - Confirmation Modal: "Broadcast this push notification to {N} employees?"
  - Send Button.
- **Email Broadcast Form:**
  - Target Audience selector.
  - Email Subject Line* (max 150 chars).
  - Email Body* (rich multiline text).
  - Send Broadcast Email button.

---

### Screen 3.4: Branches & Departments (`/root/departments`, `/root/branches`)
- **Branches List:** Cards showing Branch Name, City, State, Address, Employee Count, and Active Devices.
- **Departments List:** Department Name, Department Head (Avatar + Name), Member Count.
- **Create/Edit Sheets:** Simple clean modal forms with name, code, and parent assignments.

---

# REUSABLE MOBILE COMPONENT SYSTEM

Build the mobile application using these modular, reusable components:

### 1. `MobileAppHeader`
- Height: 56px + Safe Area Inset Top.
- Left: Organization icon and title, or Back Chevron button on nested screens.
- Center: Screen title (truncated if long).
- Right: Action triggers (Search, Notifications, Filter, or Add button).

### 2. `MobileBottomNav`
- Fixed at viewport bottom with backdrop blur (`rgba(255, 255, 255, 0.95)`).
- Height: 60px + Safe Area Inset Bottom.
- 4 navigation tabs with active indicator: icon fills with `#3525cd`, small label text, and top accent pill.
- Badge support for unread notifications and pending approvals.

### 3. `KpiCard`
- Compact white card with subtle border `#e7eefe` and shadow.
- Top: Icon inside light tint circle + metric label in uppercase 10px bold text.
- Center: Large bold number (20px font-black).
- Bottom: Comparison pill or secondary status (e.g. "↑ 4% vs yesterday" or "94% present").

### 4. `StatusBadge`
- Rounded-full pill with dot indicator:
  - `Present` / `Approved`: Green dot + text on green-50.
  - `Pending`: Amber dot + text on amber-50.
  - `Absent` / `Rejected`: Red dot + text on rose-50.
  - `WFH`: Cyan dot + text on cyan-50.
  - `Half Day`: Indigo dot + text on indigo-50.

### 5. `MobileBottomSheet`
- Slides up from bottom over dark translucent backdrop (`rgba(4, 6, 14, 0.65)` with 4px blur).
- Rounded top corners (`rounded-t-2xl`).
- Top center drag handle bar (`w-10 h-1 bg-[#c7c4d8] rounded-full mx-auto my-2`).
- Fixed header with title and close (X) button.
- Scrollable body with keyboard avoidance.
- Sticky bottom footer containing action buttons.

### 6. `ReceiptViewerModal`
- In-app zoomable lightbox for inspecting expense receipts.
- Supports both JPEG/PNG images and embedded PDF viewer with native download button.

### 7. `ConfirmationDialog`
- Alert dialog for destructive actions (Delete, Reject, Cancel, Resign).
- Warning icon, bold title, descriptive confirmation text.
- Two equal-width buttons: `Cancel` (outlined) and `Confirm` (Red or Primary).

### 8. `EmptyState`
- Centered container with 48px muted icon, bold heading, helper subtext, and optional primary CTA button.

---

# WEB-ONLY FUNCTIONALITY EXCLUSIONS

Do NOT bring the following complex desktop workflows into the mobile UI. They remain exclusive to the desktop web app:
1. **Bulk Excel/CSV Data Importers & Exporters** (e.g. bulk employee salary structure import, historical biometric raw punch import).
2. **Deep Payroll Salary Component Engine** (formula builder for HRA exemption, complex statutory tax slab builders).
3. **Biometric Hardware Socket Server Configuration** (TCP/IP port binding, gateway proxy settings).
4. **Comprehensive System Audit Logs & SQL Query Consoles**.
5. **Driver.js Interactive Onboarding Product Tours** (replace with clean mobile empty states and tooltips).

---

# IMPLEMENTATION EXPECTATIONS FOR LOVABLE

1. **Framework & Stack:** React 18, React Router v6, Tailwind CSS, Lucide React icons, TanStack React Query for cached data fetching.
2. **PWA & Mobile Viewport:**
   - Meta viewport: `width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover`.
   - Prevent elastic scroll bounces on body while maintaining smooth `-webkit-overflow-scrolling: touch` in scroll containers.
3. **Role-Based Routing:** Implement protected route wrappers (`EmployeeRoute`, `HRRoute`, `RootRoute`) switching views based on active role context.
4. **Offline Resilience:** Optimistic UI updates for Check In/Out and Approval actions with toast notifications.
5. **Pixel-Perfect Fidelity:** Strictly adhere to the Executive Precision color codes (`#3525cd`, `#f9f9ff`, `#151c27`, `#464555`, `#c7c4d8`) and component designs specified in this prompt.
```
