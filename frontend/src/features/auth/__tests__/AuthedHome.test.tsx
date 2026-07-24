// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AuthedHome } from '../AuthedHome';

/**
 * Mirror the app's auth-guard shape: an authenticated visitor hitting `/login`
 * renders <AuthedHome/>, `/` forwards to the dashboard, and the module routes
 * render a marker. This is the exact interaction that used to drop `?next=`:
 * the guard hard-coded `/` and won the redirect race against the login form,
 * so every case deep link landed on the dashboard.
 */
function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/login" element={<AuthedHome />} />
        <Route path="/register" element={<AuthedHome />} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<div>DASHBOARD</div>} />
        <Route path="/schedule" element={<div>SCHEDULE</div>} />
        <Route path="/bim/federations" element={<div>FEDERATIONS</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AuthedHome', () => {
  it('sends an authenticated visitor to the ?next= module (the demo deep link)', () => {
    renderAt('/login?next=/schedule');
    expect(screen.getByText('SCHEDULE')).toBeInTheDocument();
  });

  it('honours a nested module path', () => {
    renderAt('/login?next=/bim/federations');
    expect(screen.getByText('FEDERATIONS')).toBeInTheDocument();
  });

  it('falls back to the dashboard when there is no next', () => {
    renderAt('/login');
    expect(screen.getByText('DASHBOARD')).toBeInTheDocument();
  });

  it('does not loop back into an auth route', () => {
    renderAt('/register?next=/login');
    expect(screen.getByText('DASHBOARD')).toBeInTheDocument();
  });

  it('ignores an external next and lands on the dashboard', () => {
    renderAt('/login?next=https://evil.example.com');
    expect(screen.getByText('DASHBOARD')).toBeInTheDocument();
  });
});
