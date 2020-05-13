import { api } from 'dicomweb-client';
import {
  mapParams,
  search as qidoSearch,
  seriesInStudy,
  processResults,
  processSeriesResults,
} from './qido.js';
import { dicomMetadataStore, IWebApiDataSource, utils } from '@ohif/core';
import * as dcmjs from 'dcmjs';
import { retrieveStudyMetadata } from './retrieveStudyMetadata.js';

const { naturalizeDataset } = dcmjs.data.DicomMetaDictionary;
const { urlUtil } = utils;

/**
 *
 * @param {string} name - Data source name
 * @param {string} wadoUriRoot - Legacy? (potentially unused/replaced)
 * @param {string} qidoRoot - Base URL to use for QIDO requests
 * @param {string} wadoRoot - Base URL to use for WADO requests
 * @param {boolean} qidoSupportsIncludeField - Whether QIDO supports the "Include" option to request additional fields in response
 * @param {string} imageRengering - wadors | ? (unsure of where/how this is used)
 * @param {string} thumbnailRendering - wadors | ? (unsure of where/how this is used)
 * @param {bool} lazyLoadStudy - "enableStudyLazyLoad"; Request series meta async instead of blocking
 */
function createDicomWebApi(dicomWebConfig) {
  const { qidoRoot, wadoRoot, enableStudyLazyLoad } = dicomWebConfig;

  const qidoConfig = {
    url: qidoRoot,
    // headers: DICOMWeb.getAuthorizationHeader(server),
  };

  const wadoConfig = {
    url: wadoRoot,
  };

  // TODO -> Two clients sucks, but its better than 1000.
  // TODO -> We'll need to merge auth later.
  const qidoDicomWebClient = new api.DICOMwebClient(qidoConfig);
  const wadoDicomWebClient = new api.DICOMwebClient(wadoConfig);

  return IWebApiDataSource.create({
    query: {
      studies: {
        mapParams: mapParams.bind(),
        search: async function(origParams) {
          const { studyInstanceUid, seriesInstanceUid, ...mappedParams } =
            mapParams(origParams) || {};

          const results = await qidoSearch(
            qidoDicomWebClient,
            undefined,
            undefined,
            mappedParams
          );

          return processResults(results);
        },
        processResults: processResults.bind(),
      },
      series: {
        // mapParams: mapParams.bind(),
        search: async function(studyInstanceUid) {
          const results = await seriesInStudy(
            qidoDicomWebClient,
            studyInstanceUid
          );

          return processSeriesResults(results);
        },
        // processResults: processResults.bind(),
      },
      instances: {
        search: (studyInstanceUid, queryParamaters) =>
          qidoSearch.call(
            undefined,
            qidoDicomWebClient,
            studyInstanceUid,
            null,
            queryParamaters
          ),
      },
    },
    retrieve: {
      series: {
        metadata: (queryParams, callback) => {
          let { StudyInstanceUIDs } = urlUtil.parse(queryParams, true);

          StudyInstanceUIDs = urlUtil.paramString.parseParam(StudyInstanceUIDs);

          if (!StudyInstanceUIDs) {
            throw new Error(
              'Incomplete queryParams, missing StudyInstanceUIDs'
            );
          }

          const storeInstances = instances => {
            const naturalizedInstances = instances.map(naturalizeDataset);

            dicomMetadataStore.addInstances(naturalizedInstances);
            callback(naturalizedInstances);
          };

          const studyPromises = StudyInstanceUIDs.map(StudyInstanceUID =>
            retrieveStudyMetadata(
              wadoDicomWebClient,
              StudyInstanceUID,
              enableStudyLazyLoad
            )
          );

          studyPromises.forEach(studyPromise => {
            studyPromise.then(seriesPromises => {
              seriesPromises.forEach(seriesPromise => {
                seriesPromise.then(instances => {
                  debugger;
                  storeInstances(instances);
                });
              });
            });
          });

          // TEMP use dummy data.
          //const { naturalizeDataset } = dcmjs.data.DicomMetaDictionary;
          //const instances = exampleInstances.map(naturalizeDataset);

          // TEMP

          //dicomMetadataStore.addInstances(instances);
          //callback(instances);
        },
      },
    },
  });
}

export { createDicomWebApi };
