import React from 'react';
import { Switch, Route } from 'react-router-dom';

// Route Components
import StudyListContainer from './StudyListContainer';
import NotFound from './NotFound';

import buildModeRoutes from './buildModeRoutes';

const appRoutes = [
  { path: '/', exact: true, component: StudyListContainer },
  { path: '/viewer/:studyInstanceUids', component: NotFound },
  { component: NotFound },
];

//const modeRoutes = buildModeRoutes(window.modes, window.dataSources);

const routes = config => {
  const modes = [...config.modes, ...config.defaultModes];

  return (
    <Switch>
      {appRoutes.map((route, i) => {
        return (
          <Route
            key={i}
            path={route.path}
            exact={route.exact}
            strict={route.strict}
            // eslint-disable-next-line react/jsx-props-no-spreading
            render={props => <route.component {...props} route={route} />}
          />
        );
      })}
    </Switch>
  );
};

export default routes;
