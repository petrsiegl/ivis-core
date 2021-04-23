#!/usr/bin/env python3
import ivis_nn.elasticsearch as es
from ivis_nn.common import get_entities_signals


class TrainingParams:
    def __init__(self):
        self.architecture = None    # the architecture of neural network
        self.query = None           # the Elasticsearch query to get the desired data
        self.query_type = None      # type of the ES query ("docs" | "histogram")
        self.index = None           # the Elasticsearch index
        self.input_schema = dict()   # ES fields of input signals and their types
        self.target_schema = dict()  # ES fields of predicted signals and their types, keep empty for autoregressive models
        self.split = dict()         # Fractions of the dataset to use as training, validation and test datasets. Should sum up to 1.
        self.ts_field = None         # ES field of ts signal

    def __str__(self):
        return \
            "Training parameters" + "\n" + \
            "Architecture: " + str(self.architecture) + "\n" + \
            "Query: " + "\n" + \
            str(self.query) + "\n" + \
            "Query type: " + str(self.query_type) + \
            "Index: " + str(self.index) + "\n" + \
            "Input schema:" + "\n" + \
            str(self.input_schema) + "\n" + \
            "Target schema:" + "\n" + \
            str(self.target_schema) + \
            "Split:" + "\n" + \
            str(self.split)


#########################
# Elasticsearch queries #
#########################


def get_els_index(parameters):
    sig_set_cid = parameters["signalSet"]
    return parameters["entities"]["signalSets"][sig_set_cid]["index"]


def get_schema(signals, parameters):
    entities_signals = get_entities_signals(parameters)
    schema = dict()
    for sig in signals:
        signal = entities_signals[sig["cid"]]
        schema[signal["field"]] = {
            "type": signal["type"]
        }
    return schema


########
# Main #
########


def run_optimizer(parameters, run_training_callback, finish_training_callback, log_callback):
    """
    Runs the optimizer to try to find the best possible model for the data.

    Parameters
    ----------
    parameters : dict
        The parameters from user parsed from the JSON parameters of the IVIS Job. It should also contain the signal set,
        signals and their types in the `entities` value.
    run_training_callback : callable
        Function to run the Training task. Receives the current training parameters and should return the computed
        losses returned by the Training task.
    finish_training_callback : callable
        The only boolean argument passed to this function determines whether the trained model is the best one and
        should be saved to IVIS. This callback needs to pass the request to save the model to the Trainer Wrapper.
    log_callback : callable
        Function to print to Job log.
    """

    # prepare the parameters
    training_params = TrainingParams()
    training_params.architecture = "LSTM"
    # training_params.query, training_params.query_type = get_els_docs_query(parameters), "docs"
    training_params.query, training_params.query_type = es.get_histogram_query(parameters), "histogram"
    training_params.index = get_els_index(parameters)
    training_params.input_schema = get_schema(parameters["inputSignals"], parameters)
    training_params.target_schema = get_schema(parameters["targetSignals"], parameters)
    training_params.split = {"train": 0.7, "val": 0, "test": 0.3}

    print(training_params)

    for i in range(0):

        # do some magic...

        log_callback(f"Starting iteration {i}.")
        training_result = run_training_callback(training_params)
        log_callback(f"Result: {training_result['test_loss']}.")
        save_model = True
        finish_training_callback(save_model)