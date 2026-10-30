'use client';
/* Strings pass down through context: toolbar, detail panel and edit panel are layers of small components, and passing a prop to each is not worth it.
 * Without a Provider it is English: a host using DetailPanel on its own still gets text. */
import { createContext, useContext } from 'react';
import { EN, type GraphStrings } from '../strings';

export const StringsContext = createContext<GraphStrings>(EN);
export const useStrings = () => useContext(StringsContext);
