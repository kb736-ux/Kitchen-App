// Restaurant address lookup for clock-in geofence (web Timesheet only).
// Uses Google Places when SHEEK_GOOGLE_MAPS_API_KEY is set; otherwise Photon (OpenStreetMap).

(function () {
  let googlePlacesReady = null;
  let searchTimer = null;

  function googleMapsKey() {
    return String(window.SHEEK_GOOGLE_MAPS_API_KEY || '').trim();
  }

  function formatPhotonLabel(props) {
    const p = props || {};
    const street = [p.housenumber, p.street].filter(Boolean).join(' ').trim();
    const parts = [p.name, street || null, p.city || p.town || p.village, p.state, p.country]
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    // de-dupe consecutive repeats
    return parts.filter((part, i) => i === 0 || part.toLowerCase() !== parts[i - 1].toLowerCase()).join(', ');
  }

  async function searchPhoton(query) {
    const q = String(query || '').trim();
    if (q.length < 3) return [];
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Address lookup failed. Try again.');
    const data = await res.json();
    return (data.features || [])
      .map((f) => {
        const coords = f?.geometry?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) return null;
        const lng = Number(coords[0]);
        const lat = Number(coords[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return {
          label: formatPhotonLabel(f.properties) || q,
          latitude: lat,
          longitude: lng,
          source: 'photon',
        };
      })
      .filter(Boolean);
  }

  function loadGooglePlaces() {
    const key = googleMapsKey();
    if (!key) return Promise.resolve(false);
    if (window.google?.maps?.places) return Promise.resolve(true);
    if (googlePlacesReady) return googlePlacesReady;
    googlePlacesReady = new Promise((resolve) => {
      const existing = document.querySelector('script[data-sheek-google-maps]');
      if (existing) {
        existing.addEventListener('load', () => resolve(!!window.google?.maps?.places));
        existing.addEventListener('error', () => resolve(false));
        return;
      }
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places`;
      s.async = true;
      s.defer = true;
      s.dataset.sheekGoogleMaps = '1';
      s.onload = () => resolve(!!window.google?.maps?.places);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    return googlePlacesReady;
  }

  async function searchAddresses(query) {
    const key = googleMapsKey();
    if (key) {
      const ok = await loadGooglePlaces();
      if (ok && window.google?.maps?.places) {
        return searchGooglePlaces(query);
      }
    }
    return searchPhoton(query);
  }

  function searchGooglePlaces(query) {
    return new Promise((resolve) => {
      const q = String(query || '').trim();
      if (q.length < 3) {
        resolve([]);
        return;
      }
      const service = new window.google.maps.places.AutocompleteService();
      service.getPlacePredictions({ input: q, types: ['establishment', 'geocode'] }, (preds, status) => {
        if (status !== window.google.maps.places.PlacesServiceStatus.OK || !preds?.length) {
          resolve([]);
          return;
        }
        resolve(
          preds.slice(0, 6).map((p) => ({
            label: p.description,
            placeId: p.place_id,
            source: 'google',
          }))
        );
      });
    });
  }

  function resolveGooglePlace(placeId) {
    return new Promise((resolve, reject) => {
      const holder = document.createElement('div');
      const service = new window.google.maps.places.PlacesService(holder);
      service.getDetails({ placeId, fields: ['formatted_address', 'geometry', 'name'] }, (place, status) => {
        if (status !== window.google.maps.places.PlacesServiceStatus.OK || !place?.geometry?.location) {
          reject(new Error('Could not resolve that Google place.'));
          return;
        }
        resolve({
          label: place.formatted_address || place.name || 'Selected place',
          latitude: place.geometry.location.lat(),
          longitude: place.geometry.location.lng(),
          source: 'google',
        });
      });
    });
  }

  function ensureModal() {
    let modal = document.getElementById('clock-address-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'clock-address-modal';
    modal.className = 'clock-address-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="clock-address-card" role="dialog" aria-modal="true" aria-labelledby="clock-address-title">
        <h3 id="clock-address-title">Restaurant address</h3>
        <p class="clock-address-desc">
          Type the restaurant address, then <strong>click a suggestion</strong> from the list.
          When it says Selected, tap <strong>Confirm address</strong>.
        </p>
        <label class="clock-address-label" for="clock-address-input">Address</label>
        <div class="clock-address-search-wrap">
          <input id="clock-address-input" type="text" autocomplete="off" placeholder="Start typing the restaurant address…" />
          <ul id="clock-address-suggestions" class="clock-address-suggestions" hidden></ul>
        </div>
        <div id="clock-address-picked" class="clock-address-picked" hidden></div>
        <div class="clock-address-radius-row">
          <label for="clock-address-radius">Clock-in radius (meters)</label>
          <input id="clock-address-radius" type="number" min="25" max="2000" step="1" value="150" />
        </div>
        <p id="clock-address-error" class="clock-address-error" hidden></p>
        <div class="clock-address-actions">
          <button type="button" class="btn-secondary btn-sm" id="clock-address-cancel">Cancel</button>
          <button type="button" class="btn-primary btn-sm" id="clock-address-confirm" disabled>Confirm address</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  /**
   * Open address picker. Resolves with { address, latitude, longitude, radiusMeters }
   * or null if cancelled.
   */
  function promptRestaurantAddress({ initialAddress = '', initialRadius = 150 } = {}) {
    const modal = ensureModal();
    const input = modal.querySelector('#clock-address-input');
    const list = modal.querySelector('#clock-address-suggestions');
    const pickedEl = modal.querySelector('#clock-address-picked');
    const radiusEl = modal.querySelector('#clock-address-radius');
    const errEl = modal.querySelector('#clock-address-error');
    const confirmBtn = modal.querySelector('#clock-address-confirm');
    const cancelBtn = modal.querySelector('#clock-address-cancel');

    let selected = null;
    let results = [];

    function setError(msg) {
      if (!errEl) return;
      errEl.hidden = !msg;
      errEl.textContent = msg || '';
    }

    function setSelected(place) {
      selected = place;
      if (pickedEl) {
        if (place) {
          pickedEl.hidden = false;
          pickedEl.innerHTML = `<strong>Selected:</strong> ${escapeHtml(place.label)}`;
        } else {
          pickedEl.hidden = true;
          pickedEl.textContent = '';
        }
      }
      syncConfirmEnabled();
    }

    function syncConfirmEnabled() {
      if (!confirmBtn) return;
      const typed = String(input?.value || '').trim().length >= 3;
      confirmBtn.disabled = !(selected || typed);
    }

    function escapeHtml(text) {
      const d = document.createElement('div');
      d.textContent = String(text ?? '');
      return d.innerHTML;
    }

    function renderSuggestions(items) {
      results = items || [];
      if (!list) return;
      if (!results.length) {
        list.hidden = true;
        list.innerHTML = '';
        return;
      }
      list.hidden = false;
      list.innerHTML = results
        .map(
          (item, i) =>
            `<li><button type="button" data-idx="${i}">${escapeHtml(item.label)}</button></li>`
        )
        .join('');
    }

    async function runSearch() {
      const q = input?.value || '';
      setError('');
      try {
        const items = await searchAddresses(q);
        renderSuggestions(items);
      } catch (e) {
        renderSuggestions([]);
        setError(e?.message || 'Address search failed.');
      }
    }

    return new Promise((resolve) => {
      function cleanup(result) {
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
        input?.removeEventListener('input', onInput);
        list?.removeEventListener('click', onPick);
        cancelBtn?.removeEventListener('click', onCancel);
        confirmBtn?.removeEventListener('click', onConfirm);
        modal.removeEventListener('click', onBackdrop);
        if (searchTimer) clearTimeout(searchTimer);
        resolve(result);
      }

      function onCancel() {
        cleanup(null);
      }

      async function onConfirm() {
        confirmBtn.disabled = true;
        setError('');
        let place = selected;
        try {
          if (!place) {
            const q = String(input?.value || '').trim();
            if (q.length < 3) {
              setError('Type at least a few characters of the address.');
              syncConfirmEnabled();
              return;
            }
            const items = await searchAddresses(q);
            if (!items.length) {
              setError('No match found. Try a fuller street address (street, city, state).');
              syncConfirmEnabled();
              return;
            }
            // Prefer exact-ish match; otherwise use top result and show it as selected.
            place = items[0];
            setSelected(place);
            if (input) input.value = place.label;
          }
          if (place.placeId && !Number.isFinite(place.latitude)) {
            place = await resolveGooglePlace(place.placeId);
          }
          if (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) {
            setError('Could not pin coordinates for that address. Pick a different suggestion.');
            syncConfirmEnabled();
            return;
          }
        } catch (e) {
          setError(e?.message || 'Could not resolve address.');
          syncConfirmEnabled();
          return;
        }
        let radiusMeters = Number(radiusEl?.value);
        if (!Number.isFinite(radiusMeters) || radiusMeters < 25) radiusMeters = 150;
        radiusMeters = Math.min(2000, Math.floor(radiusMeters));
        cleanup({
          address: place.label,
          latitude: place.latitude,
          longitude: place.longitude,
          radiusMeters,
        });
      }

      function onBackdrop(e) {
        if (e.target === modal) onCancel();
      }

      function onInput() {
        setSelected(null);
        syncConfirmEnabled();
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          void runSearch();
        }, 320);
      }

      async function onPick(e) {
        const btn = e.target.closest('button[data-idx]');
        if (!btn) return;
        const idx = Number(btn.getAttribute('data-idx'));
        const item = results[idx];
        if (!item) return;
        if (input) input.value = item.label;
        list.hidden = true;
        if (item.placeId && !Number.isFinite(item.latitude)) {
          try {
            const resolved = await resolveGooglePlace(item.placeId);
            setSelected(resolved);
            if (input) input.value = resolved.label;
          } catch (err) {
            setError(err?.message || 'Could not resolve that place.');
            setSelected(null);
          }
          return;
        }
        setSelected(item);
      }

      if (input) input.value = initialAddress || '';
      if (radiusEl) radiusEl.value = String(initialRadius || 150);
      setSelected(null);
      setError('');
      renderSuggestions([]);
      syncConfirmEnabled();
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      input?.focus();

      input?.addEventListener('input', onInput);
      list?.addEventListener('click', onPick);
      cancelBtn?.addEventListener('click', onCancel);
      confirmBtn?.addEventListener('click', onConfirm);
      modal.addEventListener('click', onBackdrop);

      // Prefetch Google Places script if configured
      void loadGooglePlaces();
    });
  }

  window.kkPromptRestaurantAddress = promptRestaurantAddress;
  window.kkSearchRestaurantAddresses = searchAddresses;
  window.kkResolveRestaurantPlace = async function resolvePlace(item) {
    if (!item) throw new Error('No place selected.');
    if (item.placeId && !Number.isFinite(item.latitude)) {
      return resolveGooglePlace(item.placeId);
    }
    if (!Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) {
      throw new Error('That place has no coordinates.');
    }
    return {
      label: item.label,
      latitude: item.latitude,
      longitude: item.longitude,
      source: item.source || 'lookup',
    };
  };
})();
