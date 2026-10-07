import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const META = {
  // HR Admin
  '/dashboard':          { title: 'Dashboard',           subtitle: 'Overview of attendance & team activity' },
  '/calendar':           { title: 'Calendar',            subtitle: 'Company calendar & attendance overview' },
  '/leaves':             { title: 'Leave Management',    subtitle: 'Apply and manage leave requests' },
  '/employees':          { title: 'Team Members',        subtitle: 'Manage employees and profiles' },
  '/departments':        { title: 'Departments',         subtitle: 'Manage departments and teams' },
  '/holidays':           { title: 'Holidays',            subtitle: 'Company holiday calendar' },
  '/leave-policies':     { title: 'Leave Policies',      subtitle: 'Configure leave quotas and rules' },
  '/regularization':     { title: 'Attendance Regularization', subtitle: 'Review attendance correction requests' },
  '/reports':            { title: 'Reports & Analytics', subtitle: 'Export and analyze HR data' },
  '/documents':          { title: 'Documents',           subtitle: 'Employee document storage' },
  '/payroll':            { title: 'Payroll',             subtitle: 'Salary structures and payslips' },
  '/assets':             { title: 'Asset Management',    subtitle: 'Track company assets' },
  '/expenses':           { title: 'Expenses',            subtitle: 'Expense claims and reimbursements' },
  '/announcements':      { title: 'Announcements',       subtitle: 'Company-wide communications' },
  '/shifts':             { title: 'Shifts & Roster',     subtitle: 'Define shifts and assign rosters' },
  '/performance':        { title: 'Performance',         subtitle: 'Goals, reviews, and appraisals' },
  '/onboarding':         { title: 'Onboarding',          subtitle: 'New employee onboarding checklists' },
  '/exit-management':    { title: 'Exit Management',     subtitle: 'Resignations and offboarding' },
  '/notifications':      { title: 'Notifications',       subtitle: 'Your activity notifications' },
  '/settings':           { title: 'Settings',            subtitle: 'Work schedule and integrations' },
  '/profile':            { title: 'My Profile',          subtitle: 'Manage your account' },

  // Root Admin
  '/root/dashboard':          { title: 'Root Dashboard',      subtitle: 'Organization-wide overview' },
  '/root/calendar':           { title: 'Calendar',            subtitle: 'Company calendar & attendance overview' },
  '/root/leaves':             { title: 'Leave Management',    subtitle: 'All employee leave requests' },
  '/root/employees':          { title: 'Team Members',        subtitle: 'Manage all employees' },
  '/root/departments':        { title: 'Departments',         subtitle: 'Manage departments' },
  '/root/holidays':           { title: 'Holidays',            subtitle: 'Company holiday calendar' },
  '/root/leave-policies':     { title: 'Leave Policies',      subtitle: 'Configure leave rules' },
  '/root/regularization':     { title: 'Regularization',      subtitle: 'Attendance correction requests' },
  '/root/reports':            { title: 'Reports',             subtitle: 'Analytics and exports' },
  '/root/payroll':            { title: 'Payroll',             subtitle: 'Salary and payslips' },
  '/root/assets':             { title: 'Assets',              subtitle: 'Company asset registry' },
  '/root/expenses':           { title: 'Expenses',            subtitle: 'Expense claims' },
  '/root/announcements':      { title: 'Announcements',       subtitle: 'Company communications' },
  '/root/shifts':             { title: 'Shifts & Roster',     subtitle: 'Shift management' },
  '/root/performance':        { title: 'Performance',         subtitle: 'Employee performance' },
  '/root/onboarding':         { title: 'Onboarding',          subtitle: 'Onboarding checklists' },
  '/root/exit-management':    { title: 'Exit Management',     subtitle: 'Resignations and offboarding' },
  '/root/notifications':      { title: 'Notifications',       subtitle: 'Your notifications' },
  '/root/settings':           { title: 'Settings',            subtitle: 'Configure work schedule' },
  '/root/manage-hr':          { title: 'Manage Admins',       subtitle: 'Manage HR and root admin accounts' },
  '/root/broadcast':          { title: 'Broadcast',           subtitle: 'Send notifications to employees' },
  '/root/profile':            { title: 'My Profile',          subtitle: 'Manage your account' },

  // Employee Portal
  '/portal/home':             { title: 'My Dashboard',        subtitle: 'Your attendance and leave summary' },
  '/portal/leaves':           { title: 'My Leaves',           subtitle: 'Apply and track your leaves' },
  '/portal/attendance':       { title: 'My Attendance',       subtitle: 'Your attendance records' },
  '/portal/team-calendar':    { title: 'Team Calendar',       subtitle: "See who's on leave or WFH" },
  '/portal/regularization':   { title: 'Attendance Correction', subtitle: 'Request attendance regularization' },
  '/portal/documents':        { title: 'My Documents',        subtitle: 'Your uploaded documents' },
  '/portal/expenses':         { title: 'My Expenses',         subtitle: 'Submit and track expense claims' },
  '/portal/payslips':         { title: 'My Payslips',         subtitle: 'View your monthly payslips' },
  '/portal/performance':      { title: 'My Performance',      subtitle: 'Goals and reviews' },
  '/portal/onboarding':       { title: 'My Onboarding',       subtitle: 'Complete your onboarding tasks' },
  '/portal/exit':             { title: 'Exit & Resignation',  subtitle: 'Resignation and offboarding' },
  '/portal/announcements':    { title: 'Announcements',       subtitle: 'Company updates and news' },
  '/portal/notifications':    { title: 'Notifications',       subtitle: 'Your activity notifications' },
  '/portal/profile':          { title: 'My Profile',          subtitle: 'Manage your account' },
  '/portal/team':             { title: 'My Team',             subtitle: 'Attendance, leaves and performance of your team' },
};

export function usePageMeta() {
  const { pathname } = useLocation();
  const meta = META[pathname] || (pathname.startsWith('/portal/team/') ? META['/portal/team'] : null) || { title: 'HRMS', subtitle: '' };
  useEffect(() => {
    document.title = meta.title ? `LeaveTrackr | ${meta.title}` : 'LeaveTrackr';
  }, [meta.title]);
  return meta;
}
