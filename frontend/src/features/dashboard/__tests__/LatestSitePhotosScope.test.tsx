// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * #412, the panel the second pass left behind.
 *
 * The latest site photos card is project facing: clicking a photo sets the
 * active project and opens that project's gallery. It asked for photos across
 * every project the caller can see, with no project in the URL and none in the
 * query key, so with a project selected it showed another project's site
 * documentation under the name of the one the reader had picked.
 *
 * Both halves are asserted here, because either one alone is still wrong. The
 * URL decides what the server answers. The key decides whether the answer is
 * refetched when the selection changes: a key that does not carry the scope
 * serves the previous project's photos out of cache and no request is made at
 * all, which looks identical on screen to a server that ignored the filter.
 *
 * Mocking the api module normally hides the URL a wrapper builds. It does not
 * here, because this card builds its URL inline and hands it to `apiGet`, so
 * the mock's own argument is the thing under test.
 *
 * Run:  npx vitest run src/features/dashboard/__tests__/LatestSitePhotosScope.test.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { useProjectContextStore } from '@/stores/useProjectContextStore';

const PROJECT = { id: 'p-canary', name: 'One Canary Square' };

const harness = vi.hoisted(() => ({
  /** Every path handed to apiGet, in order. */
  urls: [] as string[],
}));

vi.mock('@/shared/lib/api', () => ({
  apiGet: (url: string) => {
    harness.urls.push(url);
    return Promise.resolve([]);
  },
}));

import { LatestSitePhotosCard } from '../components/LatestSitePhotosCard';

function renderCard() {
  // retry off and gcTime zero so each render starts from a cold cache and the
  // urls array reflects this test's own request rather than a shared one.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LatestSitePhotosCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('#412 latest site photos answers for the selected project', () => {
  beforeEach(() => {
    harness.urls.length = 0;
    // The store spells "no project" as an empty name, not a null one - the same
    // pair clearProject() writes. Passing null type-checks nowhere and would
    // put the store in a state the app cannot reach.
    useProjectContextStore.setState({ activeProjectId: null, activeProjectName: '' });
  });

  it('asks for every project when nothing is selected', async () => {
    renderCard();
    await waitFor(() => expect(harness.urls.length).toBeGreaterThan(0));
    expect(harness.urls[0]).toContain('/v1/documents/photos/recent/');
    // No selection means no narrowing. Sending an empty project_id would be a
    // different request from sending none, and the server would read it as a
    // project that does not exist.
    expect(harness.urls[0]).not.toContain('project_id');
  });

  it('carries the selected project in the URL', async () => {
    useProjectContextStore.setState({
      activeProjectId: PROJECT.id,
      activeProjectName: PROJECT.name,
    });
    renderCard();
    await waitFor(() => expect(harness.urls.length).toBeGreaterThan(0));
    expect(harness.urls[0]).toContain(`project_id=${PROJECT.id}`);
  });

  it('refetches when the selection changes rather than serving the cache', async () => {
    // One client across both renders, which is what the real page has. If the
    // key did not carry the project, the second render would be a cache hit
    // and urls would still hold exactly one entry.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
    });
    const ui = (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <LatestSitePhotosCard />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const view = render(ui);
    await waitFor(() => expect(harness.urls.length).toBe(1));

    useProjectContextStore.setState({
      activeProjectId: PROJECT.id,
      activeProjectName: PROJECT.name,
    });
    view.rerender(ui);

    await waitFor(() => expect(harness.urls.length).toBe(2));
    expect(harness.urls[1]).toContain(`project_id=${PROJECT.id}`);
  });
});
