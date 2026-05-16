import { Navigate, Outlet } from 'react-router-dom';
import { UserProfile } from '../types';

import { UserPermissions } from '../types';

interface ProtectedRouteProps {
  profile: UserProfile | null;
  allowedRoles?: ('manager' | 'cashier')[];
  permission?: keyof UserPermissions;
}

export default function ProtectedRoute({ profile, allowedRoles, permission }: ProtectedRouteProps) {
  if (!profile) return <Navigate to="/login" />;
  
  // If no restrictions are provided, allow access
  if (!allowedRoles && !permission) return <Outlet />;

  const matchesRole = allowedRoles ? allowedRoles.includes(profile.role) : false;
  const matchesPermission = permission ? !!profile.permissions?.[permission] : false;

  // Allow if either role OR permission matches (Managers typically have role: 'manager')
  if (matchesRole || matchesPermission) {
    return <Outlet />;
  }

  // Otherwise redirect to main dashboard
  return <Navigate to="/" />;
}
