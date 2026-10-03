// Country / state / city reference data.
//
// The `country-state-city` library ships a world-wide city database (~8 MB of JS). It used to be imported
// eagerly by EmployeeProfileV2, which put it in the initial Employees chunk. It is now loaded on demand —
// only when an address / education form is actually opened — and cached for the rest of the session.
import { useEffect, useState } from 'react';

let _data = null;       // resolved module data
let _promise = null;    // in-flight import (shared by every caller)

export function loadLocationData() {
  if (_data) return Promise.resolve(_data);
  if (!_promise) {
    _promise = import('country-state-city').then(({ Country, State, City }) => {
      _data = { Country, State, City, countries: Country.getAllCountries() };
      return _data;
    }).catch((err) => { _promise = null; throw err; });   // allow a retry after a failed chunk load
  }
  return _promise;
}

/**
 * @param {boolean} enabled  load the data only while a form that needs it is open
 * @returns {{ ready: boolean, countries: Array, getStates: Function, getCities: Function }}
 *   Until `ready`, lists are empty — callers keep showing the current saved value (see <CurrentOption />).
 */
export function useLocationData(enabled = true) {
  const [data, setData] = useState(_data);
  useEffect(() => {
    if (!enabled || data) return undefined;
    let alive = true;
    loadLocationData().then((d) => { if (alive) setData(d); }).catch(() => {});
    return () => { alive = false; };
  }, [enabled, data]);

  const countries = data?.countries || [];
  const getStates = (countryName) => {
    const c = countries.find(x => x.name === countryName);
    return c ? data.State.getStatesOfCountry(c.isoCode) : [];
  };
  const getCities = (countryName, stateName) => {
    const c = countries.find(x => x.name === countryName);
    if (!c) return [];
    const s = data.State.getStatesOfCountry(c.isoCode).find(x => x.name === stateName);
    return s ? data.City.getCitiesOfState(c.isoCode, s.isoCode) : [];
  };
  return { ready: !!data, countries, getStates, getCities };
}
