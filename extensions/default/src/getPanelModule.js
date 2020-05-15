import React, { useState, useEffect, useCallback } from 'react';
import { StudyBrowser } from '@ohif/ui';

import {
  dicomMetadataStore,
  useViewModel,
  displaySetManager,
} from '@ohif/core';

// Create map in local state from displaySetInstanceUids to thumbnails
// Get thumbnail imageId from displaySet
// When displaySetInstanceUids change, initiate async render into canvas
// Get image data-uri from canvas offscreen
// Set image data-uri into state (NOTE: This will probably end up in the fucking browser cache, NEED to find a way to prevent that from happening)
// state triggers rerender
//
// TODO:
// - No loading UI exists yet
// - cancel promises when component is destroyed
// - show errors in UI for thumbnails if promise fails

function getImageSrc(imageId, { cornerstone }) {
  // TODO: Switch to async/await when it stops failing
  return new Promise((resolve, reject) => {
    cornerstone.loadAndCacheImage(imageId).then(image => {
      const canvas = document.createElement('canvas');
      cornerstone.renderToCanvas(canvas, image);

      resolve(canvas.toDataURL());
    });
  });
}

function StudyBrowserPanel({ getDataSources, commandsManager }) {
  const viewModel = useViewModel();

  const dataSource = getDataSources('dicomweb')[0];
  const [studyData, setStudyData] = useState([]);
  const [thumbnailImageSrcMap, setThumbnailImageSrcMap] = useState(new Map());
  const updateThumbnailMap = (k, v) => {
    setThumbnailImageSrcMap(thumbnailImageSrcMap.set(k, v));
  };

  useEffect(() => {
    const command = commandsManager.getCommand(
      'getCornerstoneLibraries',
      'VIEWER'
    );

    if (!command) {
      throw new Error('Required command not found');
    }

    const { cornerstone, cornerstoneTools } = command.commandFn();

    if (!viewModel.displaySetInstanceUids.length) {
      return;
    }

    viewModel.displaySetInstanceUids.forEach(uid => {
      const imageIds = dataSource.getImageIdsForDisplaySet(uid);
      const imageId = imageIds[0];

      getImageSrc(imageId, { cornerstone }).then(imageSrc => {
        updateThumbnailMap(uid, imageSrc);
      });
    });
  }, [viewModel.displaySetInstanceUids]);

  // TODO
  const viewportData = []; //useViewportGrid();
  const seriesTracking = {}; //useSeriesTracking();

  const displaySets = viewModel.displaySetInstanceUids.map(
    displaySetManager.getDisplaySetByUID
  );

  // TODO:
  // - Put this in something so it only runs once
  // - Have update the query update the dicom data store at the study level and then have this component use the data in the view model
  useEffect(() => {
    if (!viewModel.displaySetInstanceUids.length) {
      return;
    }

    const dSets = viewModel.displaySetInstanceUids.map(
      displaySetManager.getDisplaySetByUID
    );

    const aDisplaySet = dSets[0];
    const firstStudy = dicomMetadataStore.getStudy(
      aDisplaySet.StudyInstanceUID
    );
    const firstInstance = firstStudy.series[0].instances[0];
    const PatientID = firstInstance.PatientID;

    dataSource.query.studies.search({ patientId: PatientID }).then(results => {
      const studies = results.map(study => {
        // TODO: Why does the data source return in this format?
        return {
          AccessionNumber: study.accession,
          StudyDate: study.date,
          StudyDescription: study.description,
          NumInstances: study.instances,
          ModalitiesInStudy: study.modalities,
          PatientID: study.mrn,
          PatientName: study.patientName,
          StudyInstanceUID: study.studyInstanceUid,
          StudyTime: study.time,
        };
      });

      setStudyData(studies);
    });
  }, [viewModel.displaySetInstanceUids]);

  const studiesFromInstanceData = {};
  displaySets.forEach(ds => {
    const displaySet = {
      displaySetInstanceUid: ds.displaySetInstanceUid,
      description: ds.SeriesDescription,
      seriesNumber: ds.SeriesNumber,
      modality: ds.Modality,
      date: ds.SeriesDate,
      numInstances: ds.numImageFrames,
      //imageSrc,
    };

    const displaySetViewportData = viewportData.find(
      a => a.displaySetInstanceUid === ds.displaySetInstanceUid
    );

    if (displaySetViewportData) {
      displaySet.viewportIdentificator = displaySetViewportData.identifier;
    }

    const trackingInfo = seriesTracking[ds.SeriesInstanceUID];
    if (trackingInfo) {
      displaySet.isTracked = trackingInfo.isTracked;

      displaySet.componentType = trackingInfo.isTracked
        ? 'thumbnailTracked'
        : 'thumbnail';
    } else {
      displaySet.isTracked = false;
      displaySet.componentType = 'thumbnail';
    }

    if (!Object.keys(studiesFromInstanceData).includes(ds.StudyInstanceUID)) {
      const study = dicomMetadataStore.getStudy(ds.StudyInstanceUID);
      const anInstance = study.series[0].instances[0];

      studiesFromInstanceData[ds.StudyInstanceUID] = {
        date: anInstance.StudyDate, // TODO: Format this date to DD-MMM-YYYY
        description: anInstance.StudyDescription,
        displaySets: [],
        numInstances: 0,
        modalitiesSet: new Set(),
      };
    }

    studiesFromInstanceData[ds.StudyInstanceUID].displaySets.push(displaySet);
    studiesFromInstanceData[ds.StudyInstanceUID].numInstances +=
      displaySet.numInstances;

    studiesFromInstanceData[ds.StudyInstanceUID].modalitiesSet.add(
      displaySet.modality
    );

    const modalitiesSet =
      studiesFromInstanceData[ds.StudyInstanceUID].modalitiesSet;
    studiesFromInstanceData[ds.StudyInstanceUID].modalities = Array.from(
      modalitiesSet
    ).join(', ');
  });

  // QIDO for all by MRN
  const allStudies = studyData.map(studyLevelData => {
    const studyFromInstanceData =
      studiesFromInstanceData[studyLevelData.StudyInstanceUID];

    if (!studyFromInstanceData) {
      return {
        studyInstanceUid: studyLevelData.StudyInstanceUID,
        date: studyLevelData.StudyDate,
        description: studyLevelData.StudyDescription,
        modalities: studyLevelData.ModalitiesInStudy,
        numInstances: studyLevelData.NumInstances,
        displaySets: [],
      };
    }

    return {
      studyInstanceUid: studyLevelData.StudyInstanceUID,
      date: studyLevelData.StudyDate || studyFromInstanceData.date,
      description:
        studyLevelData.StudyDescription || studyFromInstanceData.description,
      modalities:
        studyFromInstanceData.modalities || studyLevelData.ModalitiesInStudy,
      numInstances:
        studyLevelData.NumInstances || studyFromInstanceData.numInstances,
      displaySets: studyFromInstanceData.displaySets,
    };
  });

  const primary = allStudies.find(study => {
    return true; // TODO: check study.StudyInstanceUID matches queryparam?
  });

  // TODO: Filter allStudies to dates within one year of current date
  const recentStudies = allStudies.filter(study => {
    return true; // TODO: check study.date
  });

  const tabs = [
    {
      name: 'primary',
      label: 'Primary',
      studies: primary ? [primary] : [],
    },
    {
      name: 'recent',
      label: 'Recent',
      studies: recentStudies,
    },
    {
      name: 'all',
      label: 'All',
      studies: allStudies,
    },
  ];

  function onClickStudy(StudyInstanceUID) {
    if (studiesFromInstanceData[StudyInstanceUID]) {
      return;
    }

    console.warn(`onClickStudy: ${StudyInstanceUID}`);
    // TODO: This is weird, why can't the data source just be used as
    // as function that doesn't expect a query string?
    const queryParams = `?StudyInstanceUIDs=${StudyInstanceUID}`;

    dataSource.retrieve.series.metadata(
      queryParams,
      displaySetManager.makeDisplaySets
    );
  }

  const memoOnClickStudy = useCallback(StudyInstanceUID => {
    onClickStudy(StudyInstanceUID);
  });

  return <StudyBrowser tabs={tabs} onClickStudy={memoOnClickStudy} />;
}

function getPanelModule({ getDataSources, commandsManager }) {
  const wrappedStudyBrowserPanel = () => {
    return (
      <StudyBrowserPanel
        getDataSources={getDataSources}
        commandsManager={commandsManager}
      />
    );
  };

  return [
    {
      name: 'seriesList',
      iconName: 'group-layers',
      iconLabel: 'Studies',
      label: 'Studies',
      component: wrappedStudyBrowserPanel,
    },
    {
      name: 'measure',
      iconName: 'list-bullets',
      iconLabel: 'Measure',
      label: 'Measurements',
      component: wrappedStudyBrowserPanel,
    },
  ];
}

export default getPanelModule;
